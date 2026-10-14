import { Downsampler } from '../shared/downsampler';
import { CHUNK_SAMPLES } from '../shared/types';

/** If the worklet produces nothing over this much actual playback, fall back. */
const WORKLET_WATCHDOG_PLAYED_SECONDS = 2;
const WATCHDOG_POLL_MS = 500;

type CapturableVideo = HTMLVideoElement & {
  mozCaptureStream?: () => MediaStream;
  captureStream?: () => MediaStream;
};

interface Graph {
  ctx: AudioContext;
  /** Processors attach here; it always carries the video's current audio track. */
  tap: GainNode;
  workletLoaded?: Promise<void>;
}

/**
 * One audio graph per video element, kept for the element's lifetime: in
 * Firefox, mozCaptureStream() takes the audio away from the speakers, so the
 * graph also plays it back through ctx.destination. Tearing it down could
 * leave the video silent, and capturing twice would double the audio.
 */
const graphs = new WeakMap<HTMLVideoElement, Graph>();

function getGraph(video: CapturableVideo): Graph {
  const existing = graphs.get(video);
  if (existing) return existing;

  const isFirefox = typeof video.mozCaptureStream === 'function';
  const stream = isFirefox ? video.mozCaptureStream!() : video.captureStream!();
  const ctx = new AudioContext();
  const tap = ctx.createGain();
  let source: MediaStreamAudioSourceNode | undefined;

  // The track changes when the page swaps the video source (e.g. YouTube
  // autoplaying the next video), so re-attach whenever a new one shows up.
  const attach = () => {
    const track = stream.getAudioTracks().find((t) => t.readyState === 'live');
    if (!track) return;
    source?.disconnect();
    source = ctx.createMediaStreamSource(new MediaStream([track]));
    source.connect(tap);
    if (isFirefox) source.connect(ctx.destination);
  };
  stream.addEventListener('addtrack', attach);
  attach();

  const graph: Graph = { ctx, tap };
  graphs.set(video, graph);
  return graph;
}

/**
 * Copies a typed array that came from the page (the worklet's messages belong
 * to the page's compartment). Firefox's Xray wrappers allow reading elements
 * but deny `.constructor`, which typed-array constructors and `.buffer` views
 * touch, so copy element by element into an array this script owns.
 */
function copyFromPage(data: ArrayLike<number>): Int16Array<ArrayBuffer> {
  const copy = new Int16Array(data.length);
  for (let i = 0; i < copy.length; i++) copy[i] = data[i];
  return copy;
}

/** Streams the video's audio as 16 kHz mono Int16 chunks. */
export class AudioCapture {
  private node?: AudioNode;
  private sink?: GainNode;
  private watchdog?: ReturnType<typeof setInterval>;
  private receivedAudio = false;
  private reportedError = false;
  method?: 'worklet' | 'script-processor';

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onChunk: (pcm: Int16Array<ArrayBuffer>) => void,
  ) {}

  async start(): Promise<void> {
    const graph = getGraph(this.video);
    await graph.ctx.resume().catch(() => {});
    if (graph.ctx.state !== 'running') {
      throw new Error('The browser blocked audio processing. Click the page and try again.');
    }

    try {
      await this.attachWorklet(graph);
      console.info('[captions] capturing audio with AudioWorklet');
      // Judge by playback progress, not wall time: the page may still be
      // buffering (or showing an ad) when captions start.
      let played = 0;
      let lastTime = this.video.currentTime;
      this.watchdog = setInterval(() => {
        const now = this.video.currentTime;
        const delta = now - lastTime;
        lastTime = now;
        if (delta > 0 && delta < 2) played += delta;
        if (this.receivedAudio) {
          clearInterval(this.watchdog);
        } else if (played >= WORKLET_WATCHDOG_PLAYED_SECONDS) {
          clearInterval(this.watchdog);
          console.warn('[captions] AudioWorklet produced no audio; falling back to ScriptProcessor');
          this.detach();
          this.attachScriptProcessor(graph);
        }
      }, WATCHDOG_POLL_MS);
    } catch (err) {
      console.warn('[captions] AudioWorklet unavailable; falling back to ScriptProcessor', err);
      this.attachScriptProcessor(graph);
    }
  }

  stop(): void {
    clearInterval(this.watchdog);
    this.detach();
  }

  private async attachWorklet(graph: Graph): Promise<void> {
    graph.workletLoaded ??= graph.ctx.audioWorklet.addModule(browser.runtime.getURL('pcm-worklet.js'));
    await graph.workletLoaded;
    const node = new AudioWorkletNode(graph.ctx, 'pcm-downsampler');
    node.port.onmessage = (event: MessageEvent<Int16Array>) => this.emit(copyFromPage(event.data));
    this.connect(graph, node);
    this.method = 'worklet';
  }

  private attachScriptProcessor(graph: Graph): void {
    const node = graph.ctx.createScriptProcessor(4096, 2, 1);
    const downsampler = new Downsampler(graph.ctx.sampleRate, CHUNK_SAMPLES, (chunk) => this.emit(chunk));
    node.onaudioprocess = (event) => {
      const channels: Float32Array[] = [];
      for (let c = 0; c < event.inputBuffer.numberOfChannels; c++) channels.push(event.inputBuffer.getChannelData(c));
      downsampler.process(channels);
    };
    this.connect(graph, node);
    this.method = 'script-processor';
  }

  /** Processors only run when connected to the destination, so route them through a muted gain. */
  private connect(graph: Graph, node: AudioNode): void {
    const sink = graph.ctx.createGain();
    sink.gain.value = 0;
    graph.tap.connect(node);
    node.connect(sink).connect(graph.ctx.destination);
    this.node = node;
    this.sink = sink;
  }

  private detach(): void {
    if (!this.node) return;
    const graph = graphs.get(this.video);
    graph?.tap.disconnect(this.node);
    this.node.disconnect();
    this.sink?.disconnect();
    if (this.node instanceof AudioWorkletNode) this.node.port.close();
    if (this.node instanceof ScriptProcessorNode) this.node.onaudioprocess = null;
    this.node = undefined;
    this.sink = undefined;
  }

  private emit(chunk: Int16Array<ArrayBuffer>): void {
    try {
      this.onChunk(chunk);
      this.receivedAudio = true;
    } catch (err) {
      if (!this.reportedError) console.error('[captions] Failed to handle an audio chunk', err);
      this.reportedError = true;
    }
  }
}
