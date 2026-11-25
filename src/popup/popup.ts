import { getProvider } from '../providers/registry';
import { localizePage, t } from '../shared/i18n';
import { languageName, loadSettings } from '../shared/settings';
import { COMPANION_URL, type Help, type TabRequest, type TabState } from '../shared/types';

const summary = document.getElementById('summary')!;
const message = document.getElementById('message')!;
const help = document.getElementById('help') as HTMLAnchorElement;
const HELP: Record<Help, { text: string; url: string }> = {
  'install-companion': { text: t('popupGetCompanion'), url: COMPANION_URL },
};
const toggle = document.getElementById('toggle') as HTMLButtonElement;
const grant = document.getElementById('grant') as HTMLButtonElement;
const ALL_SITES = { origins: ['<all_urls>'] };

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function request(req: TabRequest): Promise<TabState | null> {
  const tabId = await activeTabId();
  if (tabId === undefined) return null;
  try {
    return (await browser.tabs.sendMessage(tabId, req)) as TabState;
  } catch {
    return null; // No content script on this page (about:, addons.mozilla.org, not yet reloaded…)
  }
}

function render(state: TabState | null): void {
  message.className = '';
  toggle.classList.remove('stop');
  const fix = state?.status === 'error' && state.help ? HELP[state.help] : undefined;
  help.hidden = !fix;
  help.textContent = fix?.text ?? '';
  help.href = fix?.url ?? '#';
  if (!state) {
    toggle.disabled = true;
    message.textContent = t('popupUnavailable');
    return;
  }
  if (!state.hasVideo && !state.active) {
    toggle.disabled = true;
    message.textContent = t('popupNoVideo');
    return;
  }
  toggle.disabled = false;
  toggle.textContent = state.active ? t('popupStop') : t('popupStart');
  toggle.classList.toggle('stop', state.active);
  if (state.status === 'error') {
    message.className = 'error';
    message.textContent = state.message ?? t('errorTranscription');
  } else {
    message.textContent = { idle: '', connecting: t('statusConnecting'), running: t('statusLive') }[state.status];
  }
}

async function init(): Promise<void> {
  localizePage();
  const settings = await loadSettings();
  const provider = getProvider(settings.provider);
  const language = languageName(settings.language);
  summary.textContent = `${language} · ${provider?.label ?? t('popupNoProvider')}`;

  // Firefox MV3 lets users withhold host permissions; without them the content script never loads.
  if (!(await browser.permissions.contains(ALL_SITES))) {
    grant.hidden = false;
    toggle.disabled = true;
    message.textContent = t('popupNeedsAccess');
    return;
  }
  render(await request({ type: 'get-state' }));
}

toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  render(await request({ type: 'toggle' }));
});

grant.addEventListener('click', async () => {
  if (await browser.permissions.request(ALL_SITES)) {
    grant.hidden = true;
    message.textContent = t('popupAccessGranted');
  }
});

help.addEventListener('click', (event) => {
  event.preventDefault();
  void browser.tabs.create({ url: help.href });
  window.close();
});

document.getElementById('options')!.addEventListener('click', (event) => {
  event.preventDefault();
  void browser.runtime.openOptionsPage();
  window.close();
});

void init();
