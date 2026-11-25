import { int16ToBase64 } from '../shared/encoding';
import { loadSettings, type Settings } from '../shared/settings';
import {
  type AudioRoute,
  type CompanionSource,
  type Help,
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
import { LatencyMeter } from './latency';
import { Overlay } from './overlay';
import { t } from '../shared/i18n';

const PING_INTERVAL_MS = 10_000;
const DEBUG_REFRESH_MS = 500;
/** How often the video position is reported in the system route (also sent on every play/pause/seek). */
const CLOCK_INTERVAL_MS = 250;
const CLOCK_EVENTS = ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ratechange'];

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

/**
 * Encrypted (EME) videos give silence through mozCaptureStream(), so their
 * audio has to come from the system-audio companion instead.
 */
function chooseAudio(setting: Settings['audioSource'], video: HTMLVideoElement): { route: AudioRoute; source: CompanionSource } {
  if (setting === 'tab' || setting === 'system') return { route: 'system', source: setting };
  if (setting === 'auto' && video.mediaKeys) return { route: 'system', source: 'tab' };
  return { route: 'page', source: 'tab' };
}

class LiveCaptions {
  status: SessionStatus = 'idle';
  message?: string;
  help?: Help;

  private readonly overlay: Overlay;
  private readonly port: browser.runtime.Port;
  private capture?: AudioCapture;
  private route?: AudioRoute;
  private clockTimer?: ReturnType<typeof setInterval>;
  private key = videoKey();
  private store = storeFor(this.key);
  private frame = 0;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private stopped = false;
  private debug = false;
  private readonly latency = new LatencyMeter();
  private debugTimer?: ReturnType<typeof setInterval>;
  private shownText = '';

  constructor(private readonly video: HTMLVideoElement) {
    this.overlay = new Overlay(video);
    this.port = browser.runtime.connect({ name: PORT_NAME });
    this.port.onMessage.addListener((msg) => this.onMessage(msg as ToContent));
    this.port.onDisconnect.addListener(() => {
      if (!this.stopped) this.onStatus('error', t('errorLostConnection'));
    });
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);

    video.addEventListener('pause', this.flush);
    video.addEventListener('seeking', this.flush);
    this.frame = requestAnimationFrame(this.tick);
    void loadSettings().then((settings) => {
      if (this.stopped) return;
      this.debug = settings.debug;
      if (this.debug) this.debugTimer = setInterval(this.showDebug, DEBUG_REFRESH_MS);
      const { route, source } = chooseAudio(settings.audioSource, video);
      this.route = route;
      this.send({ type: 'start', route, source, title: document.title });
      if (route === 'system') {
        // Never touch the video's own audio here: mozCaptureStream() would take it off the speakers.
        for (const event of CLOCK_EVENTS) video.addEventListener(event, this.sendClock);
        this.clockTimer = setInterval(this.sendClock, CLOCK_INTERVAL_MS);
        this.sendClock();
      }
    });
  }

  stop(): void {
    clearInterval(this.debugTimer);
    delete document.documentElement.dataset.captionsLag;
    delete document.documentElement.dataset.captionsText;
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    clearInterval(this.pingTimer);
    clearInterval(this.clockTimer);
    for (const event of CLOCK_EVENTS) this.video.removeEventListener(event, this.sendClock);
    this.video.removeEventListener('pause', this.flush);
    this.video.removeEventListener('seeking', this.flush);
    this.capture?.stop();
    this.overlay.destroy();
    this.port.disconnect();
  }

  private onMessage(msg: ToContent): void {
    if (msg.type === 'segment') {
      this.store.upsert(msg.segment);
      if (this.debug && msg.segment.words && !this.video.paused) {
        this.latency.record(msg.segment.words, this.video.currentTime);
      }
    } else if (msg.type === 'info') {
      if (!this.debug) this.overlay.setStatus(msg.message, 'info', 4000);
      console.info(`[captions] ${msg.message}`);
    } else {
      this.onStatus(msg.status, msg.message, msg.help);
    }
  }

  private onStatus(status: SessionStatus, message?: string, help?: Help): void {
    this.status = status;
    this.message = message;
    this.help = help;
    switch (status) {
      case 'connecting':
        this.overlay.setStatus(t('statusConnecting'));
        break;
      case 'running':
        if (!this.debug) this.overlay.setStatus('● Live captions', 'info', 2000);
        break;
      case 'error':
        this.overlay.setStatus(message ?? t('errorTranscription'), 'error');
        this.capture?.stop();
        this.capture = undefined;
        return;
    }
    // The provider buffers while connecting, so start streaming right away.
    if (!this.capture && this.route === 'page') void this.startAudio();
  }

  private async startAudio(): Promise<void> {
    this.capture = new AudioCapture(this.video, (pcm) => this.sendAudio(pcm));
    try {
      await this.capture.start();
    } catch (err) {
      this.onStatus('error', t('errorCapture', err instanceof Error ? err.message : String(err)));
    }
  }

  private sendAudio(pcm: Int16Array): void {
    if (this.video.paused || this.video.seeking) return;
    const rate = this.video.playbackRate;
    // The chunk just finished playing; its first sample was this far back.
    const mediaTime = this.video.currentTime - (pcm.length / SAMPLE_RATE) * rate;
    this.send({ type: 'audio', pcm: int16ToBase64(pcm), mediaTime, rate });
  }

  private readonly sendClock = () => {
    const video = this.video;
    this.send({
      type: 'clock',
      mediaTime: video.currentTime,
      rate: video.playbackRate,
      // Buffering stalls the audio as much as pausing does.
      playing: !video.paused && !video.seeking && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
      at: Date.now(),
      title: document.title,
    });
  };

  private readonly flush = () => {
    this.store.newRun();
    this.latency.reset();
    this.send({ type: 'flush' });
  };

  private readonly tick = () => {
    if (!this.video.isConnected) {
      this.onStatus('error', t('errorVideoRemoved'));
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
    const now = this.video.currentTime;
    const segment = this.store.at(now);
    this.overlay.showSegment(segment, now);
    this.shownText = segment?.text ?? '';
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Latency readout on the overlay, mirrored to data attributes for the e2e harness. */
  private readonly showDebug = () => {
    if (this.status === 'error') return;
    const median = this.latency.median;
    const lag = median === undefined ? '–' : `${median.toFixed(2)} s`;
    this.overlay.setStatus(`lag ${lag} (median of ${this.latency.count} words)`);
    const data = document.documentElement.dataset;
    data.captionsLag = median?.toFixed(3) ?? '';
    data.captionsText = this.shownText;
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
    help: live?.help,
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
