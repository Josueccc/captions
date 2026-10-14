import { getProvider } from '../providers/registry';
import { resolveOptions, type Transcriber } from '../providers/types';
import { base64ToInt16 } from '../shared/encoding';
import { loadSettings } from '../shared/settings';
import { PORT_NAME, SAMPLE_RATE, type SessionStatus, type TabRequest, type ToBackground, type ToContent } from '../shared/types';
import { Companion } from './companion';
import { MediaClock } from './media-clock';

type Clock = Extract<ToBackground, { type: 'clock' }>;

/** Companion audio is placed by extrapolating the last clock; past this it's too old to trust. */
const MAX_CLOCK_AGE_MS = 3000;

/** One transcription session per content-script port (i.e. per tab). */
class Session {
  private transcriber?: Transcriber;
  private companion?: Companion;
  /** Latest video position reported by the content script (system route only). */
  private videoClock?: Clock;
  private readonly clock = new MediaClock();
  private samplesSent = 0;
  private closed = false;

  constructor(private readonly port: browser.runtime.Port) {
    port.onMessage.addListener((msg) => this.onMessage(msg as ToBackground));
    port.onDisconnect.addListener(() => {
      this.closed = true;
      this.transcriber?.stop();
      this.companion?.stop();
    });
  }

  private onMessage(msg: ToBackground): void {
    switch (msg.type) {
      case 'start':
        void this.start(msg);
        break;
      case 'audio':
        this.pushAudio(base64ToInt16(msg.pcm), msg.mediaTime, msg.rate);
        break;
      case 'clock':
        this.videoClock = msg;
        this.companion?.setTitle(msg.title);
        break;
      case 'flush':
        this.transcriber?.flush();
        break;
      case 'ping':
        // Keeps the event page alive while the video is paused.
        break;
    }
  }

  private pushAudio(pcm: Int16Array<ArrayBuffer>, mediaTime: number, rate: number): void {
    if (!this.transcriber) return;
    this.clock.add(this.samplesSent / SAMPLE_RATE, mediaTime, rate);
    this.samplesSent += pcm.length;
    this.transcriber.pushAudio(pcm);
  }

  /**
   * Companion audio carries the wall-clock time it was recorded; the video
   * clock turns that into media time. While the video is paused or seeking,
   * whatever the system plays isn't the video, so it's dropped.
   */
  private pushCompanionAudio(pcm: Int16Array<ArrayBuffer>, endedAt: number): void {
    const clock = this.videoClock;
    if (!clock?.playing) return;
    const startedAt = endedAt - (pcm.length / SAMPLE_RATE) * 1000;
    if (startedAt - clock.at > MAX_CLOCK_AGE_MS) return;
    this.pushAudio(pcm, clock.mediaTime + ((startedAt - clock.at) / 1000) * clock.rate, clock.rate);
  }

  private async start(msg: Extract<ToBackground, { type: 'start' }>): Promise<void> {
    const settings = await loadSettings();
    const provider = getProvider(settings.provider);
    if (!provider) {
      this.status('error', `Unknown provider "${settings.provider}". Pick one in the options.`);
      return;
    }
    if (this.closed) return;

    this.transcriber = provider.create(
      { language: settings.language, options: resolveOptions(provider, settings.providerOptions[provider.id]) },
      {
        segment: (segment) => this.post({ type: 'segment', segment: this.clock.toMediaSegment(segment) }),
        status: (status, message) => this.status(status, message),
      },
    );
    try {
      this.transcriber.start();
    } catch (err) {
      this.status('error', `Failed to start ${provider.label}: ${err}`);
      return;
    }
    if (msg.route === 'system') {
      this.companion = new Companion(msg.source, msg.title, {
        audio: (pcm, endedAt) => this.pushCompanionAudio(pcm, endedAt),
        info: (message) => this.post({ type: 'info', message }),
        error: (message) => {
          this.status('error', message);
          this.transcriber?.stop();
        },
      });
    }
  }

  private status(status: SessionStatus, message?: string): void {
    this.post({ type: 'status', status, message });
  }

  private post(msg: ToContent): void {
    if (this.closed) return;
    try {
      this.port.postMessage(msg);
    } catch {
      this.closed = true;
    }
  }
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAME) new Session(port);
});

browser.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-captions') return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const request: TabRequest = { type: 'toggle' };
  browser.tabs.sendMessage(tab.id, request).catch(() => {});
});
