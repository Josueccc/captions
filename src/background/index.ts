import { getProvider } from '../providers/registry';
import { resolveOptions, type Transcriber } from '../providers/types';
import { base64ToInt16 } from '../shared/encoding';
import { loadSettings } from '../shared/settings';
import { PORT_NAME, SAMPLE_RATE, type SessionStatus, type TabRequest, type ToBackground, type ToContent } from '../shared/types';
import { MediaClock } from './media-clock';

/** One transcription session per content-script port (i.e. per tab). */
class Session {
  private transcriber?: Transcriber;
  private readonly clock = new MediaClock();
  private samplesSent = 0;
  private closed = false;

  constructor(private readonly port: browser.runtime.Port) {
    port.onMessage.addListener((msg) => this.onMessage(msg as ToBackground));
    port.onDisconnect.addListener(() => {
      this.closed = true;
      this.transcriber?.stop();
    });
  }

  private onMessage(msg: ToBackground): void {
    switch (msg.type) {
      case 'start':
        void this.start();
        break;
      case 'audio': {
        if (!this.transcriber) return;
        const pcm = base64ToInt16(msg.pcm);
        this.clock.add(this.samplesSent / SAMPLE_RATE, msg.mediaTime, msg.rate);
        this.samplesSent += pcm.length;
        this.transcriber.pushAudio(pcm);
        break;
      }
      case 'flush':
        this.transcriber?.flush();
        break;
      case 'ping':
        // Keeps the event page alive while the video is paused.
        break;
    }
  }

  private async start(): Promise<void> {
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
