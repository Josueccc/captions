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

export const LANGUAGES: [code: string, label: string][] = [
  ['fr', 'French'],
  ['de', 'German'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['en', 'English'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['ru', 'Russian'],
];

export async function loadSettings(): Promise<Settings> {
  const { settings } = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings });
}
