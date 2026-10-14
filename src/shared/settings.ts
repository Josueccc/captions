export interface Settings {
  provider: string;
  language: string;
  /** Per-provider option values, keyed by provider id then field key. */
  providerOptions: Record<string, Record<string, string>>;
  /** Show caption latency on the overlay and expose it as data-captions-* attributes. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'deepgram',
  language: 'fr',
  providerOptions: {},
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
