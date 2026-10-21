import { base64ToInt16 } from '../shared/encoding';
import type { CompanionSource, Help } from '../shared/types';

const HOST = 'captions_companion';

type FromHost =
  | { type: 'audio'; pcm: string; t: number }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string };

export interface CompanionEvents {
  /** endedAt: wall-clock time (ms) when the chunk's last sample was recorded. */
  audio(pcm: Int16Array<ArrayBuffer>, endedAt: number): void;
  info(message: string): void;
  error(message: string, help?: Help): void;
}

/**
 * The system-audio companion (companion/ in the repo): a native-messaging host
 * that records Firefox's output (PipeWire on Linux, WASAPI on Windows), after
 * the browser has decoded it, for videos the page can't capture. One host
 * process per session.
 */
export class Companion {
  private readonly port: browser.runtime.Port;
  private title: string;
  private stopped = false;

  constructor(source: CompanionSource, title: string, events: CompanionEvents) {
    this.title = title;
    this.port = browser.runtime.connectNative(HOST);
    this.port.onMessage.addListener((raw) => {
      const msg = raw as FromHost;
      if (msg.type === 'audio') events.audio(base64ToInt16(msg.pcm), msg.t);
      else if (msg.type === 'status') events.info(msg.message);
      else events.error(msg.message);
    });
    this.port.onDisconnect.addListener((port) => {
      if (this.stopped) return;
      const error = port.error?.message ?? '';
      if (/No such native application|not found/i.test(error)) {
        events.error(
          'DRM-protected videos need the Captions companion app, which is not installed. Open the Captions toolbar button to get it.',
          'install-companion',
        );
      } else {
        events.error(`The system-audio companion stopped${error ? `: ${error}` : '.'}`);
      }
    });
    this.port.postMessage({ type: 'start', source, title });
  }

  /** The tab's audio stream is named after the page title; keep the companion's match current. */
  setTitle(title: string): void {
    if (title === this.title || this.stopped) return;
    this.title = title;
    this.port.postMessage({ type: 'title', title });
  }

  stop(): void {
    this.stopped = true;
    this.port.disconnect();
  }
}
