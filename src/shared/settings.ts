export interface Settings {
  provider: string;
  language: string;
  /** Per-provider option values, keyed by provider id then field key. */
  providerOptions: Record<string, Record<string, string>>;
  /**
   * page: capture the <video> element. tab/system: record through the
   * system-audio companion (the tab's stream, or all system audio).
   * auto: the companion's tab stream for DRM-protected videos, the page otherwise.
   */
  audioSource: 'auto' | 'page' | 'tab' | 'system';
  /** Show caption latency on the overlay and expose it as data-captions-* attributes. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'deepgram',
  language: 'fr',
  providerOptions: {},
  audioSource: 'auto',
  debug: false,
};

/** Languages offered for the audio, as BCP 47 codes (what Deepgram and Whisper take). */
export const LANGUAGES = ['fr', 'de', 'es', 'it', 'pt', 'nl', 'en', 'ja', 'ko', 'zh', 'ru'];

/** The language's name in the browser's own language ("French", "francés"…). */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([browser.i18n.getUILanguage()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export async function loadSettings(): Promise<Settings> {
  const { settings } = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings });
}
