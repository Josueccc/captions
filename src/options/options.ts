import { getProvider, PROVIDERS } from '../providers/registry';
import { resolveOptions, type ProviderDefinition, type SettingField } from '../providers/types';
import { checkCompanion, type CompanionCheck } from '../shared/companion-check';
import { localizePage, t } from '../shared/i18n';
import { languageName, LANGUAGES, loadSettings, saveSettings, type Settings } from '../shared/settings';
import { COMPANION_DOWNLOADS, COMPANION_URL } from '../shared/types';

/** Typing in a text field saves this long after the last keystroke. */
const SAVE_DELAY_MS = 600;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const languageSelect = $<HTMLSelectElement>('language');
const providersBox = $('providers');
const providerFields = $('provider-fields');
const testRow = $('test-row');
const testButton = $<HTMLButtonElement>('test');
const testResult = $('test-result');
const audioSourcesBox = $('audio-sources');
const companionBox = $('companion');
const companionPill = $('companion-pill');
const companionDetail = $('companion-detail');
const companionDownload = $<HTMLAnchorElement>('companion-download');
const companionRecheck = $<HTMLButtonElement>('companion-recheck');
const debugCheckbox = $<HTMLInputElement>('debug');
const saveState = $('save-state');

let settings: Settings;
/** The provider whose fields are on screen (lags the radio by one change event). */
let shownProvider: ProviderDefinition;

// ---------------------------------------------------------------- helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** A radio "card": title and description, part of a radiogroup. */
function choice(name: string, value: string, title: string, description: string, checked: boolean): HTMLLabelElement {
  const input = el('input', { type: 'radio', name, value, checked });
  return el(
    'label',
    { className: 'choice' },
    input,
    el('span', { className: 'choice-text' }, el('span', { className: 'choice-title' }, title), el('small', {}, description)),
  );
}

function checkedValue(name: string): string | undefined {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
}

// ---------------------------------------------------------------- provider

function fieldInput(field: SettingField, value: string): HTMLElement {
  if (field.type === 'select') {
    const select = el('select', { name: field.key, id: `f-${field.key}` });
    for (const [v, label] of field.options ?? []) select.append(el('option', { value: v, textContent: label }));
    select.value = value || field.default || '';
    return select;
  }
  const input = el('input', {
    type: field.type,
    name: field.key,
    id: `f-${field.key}`,
    value,
    placeholder: field.placeholder ?? field.default ?? '',
    required: field.required ?? false,
    autocomplete: 'off',
    spellcheck: false,
  });
  if (field.type !== 'password') return input;
  // Show/hide toggle, so a pasted key can be checked.
  const toggle = el('button', { type: 'button', className: 'reveal', textContent: t('fieldShow') });
  toggle.setAttribute('aria-pressed', 'false');
  toggle.addEventListener('click', () => {
    const shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    toggle.textContent = shown ? t('fieldHide') : t('fieldShow');
    toggle.setAttribute('aria-pressed', String(shown));
  });
  return el('div', { className: 'with-button' }, input, toggle);
}

function fieldRow(field: SettingField, value: string): HTMLElement {
  const row = el('div', { className: 'field' });
  const label = el('label', { className: 'label', htmlFor: `f-${field.key}`, textContent: field.label });
  if (field.required) label.append(el('span', { className: 'required', textContent: ' *', title: t('fieldRequired') }));
  row.append(label, fieldInput(field, value));
  if (field.help) row.append(el('small', { textContent: field.help }));
  return row;
}

function renderProviderFields(provider: ProviderDefinition): void {
  shownProvider = provider;
  const stored = settings.providerOptions[provider.id] ?? {};
  const basic = provider.fields.filter((f) => !f.advanced);
  const advanced = provider.fields.filter((f) => f.advanced);
  const children: HTMLElement[] = basic.map((f) => fieldRow(f, stored[f.key] ?? ''));
  if (advanced.length) {
    const details = el('details', { className: 'advanced' }, el('summary', { textContent: t('advancedOptions') }));
    details.open = advanced.some((f) => stored[f.key]);
    details.append(...advanced.map((f) => fieldRow(f, stored[f.key] ?? '')));
    children.push(details);
  }
  providerFields.replaceChildren(...children);
  providerFields.hidden = children.length === 0;
  testRow.hidden = !provider.test;
  testResult.textContent = '';
  testResult.dataset.state = '';
}

function selectedProvider(): ProviderDefinition {
  return getProvider(checkedValue('provider') ?? '') ?? PROVIDERS[0];
}

function providerValues(provider: ProviderDefinition): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of provider.fields) {
    const input = providerFields.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${field.key}"]`);
    values[field.key] = input?.value.trim() ?? '';
  }
  return values;
}

async function runTest(): Promise<void> {
  const provider = shownProvider;
  if (!provider.test) return;
  testButton.disabled = true;
  testResult.dataset.state = 'pending';
  testResult.textContent = t('testRunning');
  try {
    await provider.test({
      language: languageSelect.value,
      options: resolveOptions(provider, providerValues(provider)),
    });
    testResult.dataset.state = 'ok';
    testResult.textContent = t('testOk');
  } catch (err) {
    testResult.dataset.state = 'error';
    testResult.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    testButton.disabled = false;
  }
}

// ---------------------------------------------------------------- audio source

const AUDIO_SOURCES: Settings['audioSource'][] = ['auto', 'page', 'tab', 'system'];

function renderAudioSources(): void {
  audioSourcesBox.replaceChildren(
    ...AUDIO_SOURCES.map((value) =>
      choice('audio-source', value, t(`audio_${value}`), t(`audio_${value}_help`), settings.audioSource === value),
    ),
  );
}

/** Whether the chosen audio source can use the companion at all. */
function usesCompanion(): boolean {
  return checkedValue('audio-source') !== 'page';
}

// ---------------------------------------------------------------- companion

let platform: browser.runtime.PlatformOs | undefined;

function showCompanion(check: CompanionCheck | 'checking'): void {
  const supported = platform === undefined || platform in COMPANION_DOWNLOADS;
  const state = !supported ? 'unsupported' : check === 'checking' ? 'checking' : check.state;
  companionPill.dataset.state = state;
  companionPill.textContent =
    state === 'installed' && check !== 'checking' && check.state === 'installed'
      ? t('companion_installed_pill', check.version)
      : t(`companion_${state}_pill`);
  companionDetail.textContent =
    state === 'checking'
      ? ''
      : check !== 'checking' && check.state === 'broken'
        ? t('companion_broken', check.message || '?')
        : t(`companion_${state}${state === 'missing' && platform === 'linux' ? '_linux' : ''}`);

  const download = platform && COMPANION_DOWNLOADS[platform];
  const offerDownload = supported && (state === 'missing' || state === 'outdated' || state === 'broken');
  companionDownload.hidden = !offerDownload || !download;
  if (download) {
    companionDownload.href = download;
    companionDownload.textContent = t(platform === 'win' ? 'companionDownloadWindows' : 'companionDownloadLinux');
  }
  companionRecheck.hidden = !supported || state === 'checking';
}

async function refreshCompanion(): Promise<void> {
  showCompanion('checking');
  showCompanion(await checkCompanion());
}

function updateCompanionEmphasis(): void {
  companionBox.classList.toggle('inactive', !usesCompanion());
}

// ---------------------------------------------------------------- shortcut

async function renderShortcut(): Promise<void> {
  const commands = await browser.commands.getAll();
  const shortcut = commands.find((c) => c.name === 'toggle-captions')?.shortcut;
  $('shortcut').textContent = shortcut || t('shortcutNone');
  const change = $<HTMLButtonElement>('shortcut-change');
  // commands.openShortcutSettings() is Firefox 137+; hide the button where it's missing.
  const open = (browser.commands as { openShortcutSettings?: () => Promise<void> }).openShortcutSettings;
  change.hidden = !open;
  change.addEventListener('click', () => void open?.());
}

// ---------------------------------------------------------------- saving

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savedTimer: ReturnType<typeof setTimeout> | undefined;

function collect(): Settings {
  return {
    ...settings,
    language: languageSelect.value,
    provider: selectedProvider().id,
    debug: debugCheckbox.checked,
    audioSource: (checkedValue('audio-source') ?? 'auto') as Settings['audioSource'],
    providerOptions: { ...settings.providerOptions, [shownProvider.id]: providerValues(shownProvider) },
  };
}

async function save(): Promise<void> {
  clearTimeout(saveTimer);
  settings = collect();
  await saveSettings(settings);
  saveState.textContent = t('saved');
  saveState.dataset.state = 'saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    saveState.textContent = '';
    saveState.dataset.state = '';
  }, 2000);
}

function saveSoon(): void {
  saveState.textContent = t('saving');
  saveState.dataset.state = 'pending';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
}

// ---------------------------------------------------------------- init

async function init(): Promise<void> {
  localizePage();
  ($('companion-all') as HTMLAnchorElement).href = COMPANION_URL;
  settings = await loadSettings();

  for (const code of LANGUAGES) languageSelect.append(el('option', { value: code, textContent: `${languageName(code)} (${code})` }));
  languageSelect.value = settings.language;

  const current = getProvider(settings.provider) ?? PROVIDERS[0];
  providersBox.replaceChildren(...PROVIDERS.map((p) => choice('provider', p.id, p.label, p.description, p.id === current.id)));
  renderProviderFields(current);
  renderAudioSources();
  updateCompanionEmphasis();
  debugCheckbox.checked = settings.debug;

  platform = (await browser.runtime.getPlatformInfo()).os;
  void refreshCompanion();
  void renderShortcut();
}

providersBox.addEventListener('change', () => {
  // Keep what was typed for the previous provider before its fields go away.
  settings = collect();
  renderProviderFields(selectedProvider());
  void save();
});
audioSourcesBox.addEventListener('change', () => {
  updateCompanionEmphasis();
  void save();
});
languageSelect.addEventListener('change', () => void save());
debugCheckbox.addEventListener('change', () => void save());
providerFields.addEventListener('change', (e) => {
  if (e.target instanceof HTMLSelectElement) void save();
});
providerFields.addEventListener('input', (e) => {
  if (e.target instanceof HTMLInputElement) saveSoon();
});
testButton.addEventListener('click', () => void runTest());
companionRecheck.addEventListener('click', () => void refreshCompanion());
// Don't lose a pending text edit when the tab closes.
window.addEventListener('pagehide', () => {
  if (saveState.dataset.state === 'pending') void save();
});

void init();
