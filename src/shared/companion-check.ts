/** The native-messaging host name the companion registers (companion/src/register.rs). */
export const COMPANION_HOST = 'captions_companion';

/** How long to wait for the companion's reply before deciding it's an older build. */
const HELLO_TIMEOUT_MS = 3000;

export type CompanionCheck =
  /** Not registered with Firefox (or the registered file is gone). */
  | { state: 'missing' }
  /** Replied to "hello". */
  | { state: 'installed'; version: string; os: string }
  /** Started but didn't answer "hello": a build from before 0.3.0. */
  | { state: 'outdated' }
  /** Registered, but Firefox couldn't run it. */
  | { state: 'broken'; message: string };

/**
 * Starts the companion just long enough to ask its version. It records
 * nothing: capture only begins on a "start" message.
 */
export function checkCompanion(): Promise<CompanionCheck> {
  return new Promise((resolve) => {
    let port: browser.runtime.Port;
    try {
      port = browser.runtime.connectNative(COMPANION_HOST);
    } catch (err) {
      resolve({ state: 'broken', message: String(err) });
      return;
    }
    let done = false;
    const finish = (result: CompanionCheck) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      port.disconnect();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ state: 'outdated' }), HELLO_TIMEOUT_MS);
    port.onMessage.addListener((raw) => {
      const msg = raw as { type?: string; version?: string; os?: string };
      if (msg.type === 'hello') finish({ state: 'installed', version: msg.version ?? '?', os: msg.os ?? '' });
    });
    port.onDisconnect.addListener((p) => {
      const error = p.error?.message ?? '';
      // No error at all: it started and exited before answering.
      finish(/No such native application|not found/i.test(error) ? { state: 'missing' } : { state: 'broken', message: error });
    });
    port.postMessage({ type: 'hello' });
  });
}
