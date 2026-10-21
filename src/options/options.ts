import { getProvider, PROVIDERS } from '../providers/registry';
import type { ProviderDefinition, SettingField } from '../providers/types';
import { LANGUAGES, loadSettings, saveSettings, type Settings } from '../shared/settings';
import { COMPANION_URL } from '../shared/types';

const form = document.getElementById('form') as HTMLFormElement;
const languageSelect = document.getElementById('language') as HTMLSelectElement;
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const providerDescription = document.getElementById('provider-description')!;
const providerFields = document.getElementById('provider-fields')!;
const saved = document.getElementById('saved')!;
const debugCheckbox = document.getElementById('debug') as HTMLInputElement;
const audioSourceSelect = document.getElementById('audio-source') as HTMLSelectElement;
(document.getElementById('companion-link') as HTMLAnchorElement).href = COMPANION_URL;

let settings: Settings;

function option(value: string, label: string): HTMLOptionElement {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
}

function fieldInput(field: SettingField, value: string): HTMLInputElement | HTMLSelectElement {
  if (field.type === 'select') {
    const select = document.createElement('select');
    for (const [v, label] of field.options ?? []) select.append(option(v, label));
    select.value = value || field.default || '';
    return select;
  }
  const input = document.createElement('input');
  input.type = field.type;
  input.value = value;
  input.placeholder = field.placeholder ?? field.default ?? '';
  input.required = field.required ?? false;
  input.autocomplete = 'off';
  return input;
}

function renderProviderFields(provider: ProviderDefinition): void {
  providerDescription.textContent = provider.description;
  const stored = settings.providerOptions[provider.id] ?? {};
  providerFields.replaceChildren(
    ...provider.fields.map((field) => {
      const label = document.createElement('label');
      const title = document.createElement('span');
      title.textContent = field.label;
      const input = fieldInput(field, stored[field.key] ?? '');
      input.name = field.key;
      label.append(title, input);
      if (field.help) {
        const help = document.createElement('small');
        help.textContent = field.help;
        label.append(help);
      }
      return label;
    }),
  );
}

async function init(): Promise<void> {
  settings = await loadSettings();
  for (const [code, label] of LANGUAGES) languageSelect.append(option(code, `${label} (${code})`));
  for (const provider of PROVIDERS) providerSelect.append(option(provider.id, provider.label));
  languageSelect.value = settings.language;
  debugCheckbox.checked = settings.debug;
  audioSourceSelect.value = settings.audioSource;
  providerSelect.value = getProvider(settings.provider) ? settings.provider : PROVIDERS[0].id;
  renderProviderFields(getProvider(providerSelect.value)!);
}

providerSelect.addEventListener('change', () => renderProviderFields(getProvider(providerSelect.value)!));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const provider = getProvider(providerSelect.value)!;
  const values: Record<string, string> = {};
  for (const field of provider.fields) {
    const input = providerFields.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${field.key}"]`);
    values[field.key] = input?.value.trim() ?? '';
  }
  settings = {
    ...settings,
    language: languageSelect.value,
    provider: provider.id,
    debug: debugCheckbox.checked,
    audioSource: audioSourceSelect.value as Settings['audioSource'],
    providerOptions: { ...settings.providerOptions, [provider.id]: values },
  };
  await saveSettings(settings);
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 2000);
});

void init();
