import { int16ToBase64 } from '../shared/encoding';
import {
  PORT_NAME,
  SAMPLE_RATE,
  type SessionStatus,
  type TabRequest,
  type TabState,
  type ToBackground,
  type ToContent,
} from '../shared/types';
import { AudioCapture } from './audio-capture';
import { CaptionStore } from './caption-store';
import { Overlay } from './overlay';

const PING_INTERVAL_MS = 10_000;

/** Captions are cached per video for the life of the page. */
const stores = new Map<string, CaptionStore>();

function videoKey(): string {
  const url = new URL(location.href);
  const youtubeId = url.hostname.endsWith('youtube.com') ? url.searchParams.get('v') : null;
  return youtubeId ? `youtube:${youtubeId}` : url.origin + url.pathname;
}

function storeFor(key: string): CaptionStore {
  let store = stores.get(key);
  if (!store) stores.set(key, (store = new CaptionStore()));
  return store;
}

/** The biggest visible video, preferring one that is playing. */
function findVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = 0;
  for (const video of document.querySelectorAll('video')) {
    const r = video.getBoundingClientRect();
    const score = r.width * r.height * (video.paused ? 1 : 2);
    if (score > bestScore) {
      best = video;
      bestScore = score;
    }
  }
  return best;
}

class LiveCaptions {
  status: SessionStatus = 'idle';
  message?: string;

  private readonly overlay: Overlay;
  private readonly port: browser.runtime.Port;
  private capture?: AudioCapture;
  private key = videoKey();
  private store = storeFor(this.key);
  private frame = 0;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(private readonly video: HTMLVideoElement) {
    this.overlay = new Overlay(video);
    this.port = browser.runtime.connect({ name: PORT_NAME });
    this.port.onMessage.addListener((msg) => this.onMessage(msg as ToContent));
    this.port.onDisconnect.addListener(() => {
      if (!this.stopped) this.onStatus('error', 'Lost connection to the extension. Toggle captions to retry.');
    });
    this.send({ type: 'start' });
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);

    video.addEventListener('pause', this.flush);
    video.addEventListener('seeking', this.flush);
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    clearInterval(this.pingTimer);
    this.video.removeEventListener('pause', this.flush);
    this.video.removeEventListener('seeking', this.flush);
    this.capture?.stop();
    this.overlay.destroy();
    this.port.disconnect();
  }

  private onMessage(msg: ToContent): void {
    if (msg.type === 'segment') this.store.upsert(msg.segment);
    else this.onStatus(msg.status, msg.message);
  }

  private onStatus(status: SessionStatus, message?: string): void {
    this.status = status;
    this.message = message;
    switch (status) {
      case 'connecting':
        this.overlay.setStatus('Connecting…');
        break;
      case 'running':
        this.overlay.setStatus('● Live captions', 'info', 2000);
        break;
      case 'error':
        this.overlay.setStatus(message ?? 'Transcription error', 'error');
        this.capture?.stop();
        this.capture = undefined;
        return;
    }
    // The provider buffers while connecting, so start streaming right away.
    if (!this.capture) void this.startAudio();
  }

  private async startAudio(): Promise<void> {
    this.capture = new AudioCapture(this.video, (pcm) => this.sendAudio(pcm));
    try {
      await this.capture.start();
    } catch (err) {
      this.onStatus('error', `Could not capture audio: ${err instanceof Error ? err.message : err}`);
    }
  }

  private sendAudio(pcm: Int16Array): void {
    if (this.video.paused || this.video.seeking) return;
    const rate = this.video.playbackRate;
    // The chunk just finished playing; its first sample was this far back.
    const mediaTime = this.video.currentTime - (pcm.length / SAMPLE_RATE) * rate;
    this.send({ type: 'audio', pcm: int16ToBase64(pcm), mediaTime, rate });
  }

  private readonly flush = () => {
    this.store.newRun();
    this.send({ type: 'flush' });
  };

  private readonly tick = () => {
    if (!this.video.isConnected) {
      this.onStatus('error', 'The video was removed from the page.');
      return;
    }
    // Single-page sites (YouTube) reuse the same <video> for the next video.
    const key = videoKey();
    if (key !== this.key) {
      this.key = key;
      this.store = storeFor(key);
      this.flush();
    }
    this.overlay.layout();
    const t = this.video.currentTime;
    this.overlay.showSegment(this.store.at(t), t);
    this.frame = requestAnimationFrame(this.tick);
  };

  private send(msg: ToBackground): void {
    if (this.stopped) return;
    try {
      this.port.postMessage(msg);
    } catch {
      // Port already gone; onDisconnect reports it.
    }
  }
}

let live: LiveCaptions | null = null;

function state(): TabState {
  return {
    hasVideo: findVideo() !== null,
    active: live !== null,
    status: live?.status ?? 'idle',
    message: live?.message,
  };
}

browser.runtime.onMessage.addListener((msg: unknown) => {
  const request = msg as TabRequest;
  if (request.type === 'toggle') {
    if (live) {
      live.stop();
      live = null;
    } else {
      const video = findVideo();
      if (video) live = new LiveCaptions(video);
    }
  }
  return Promise.resolve(state());
});
