/**
 * Translations live in src/_locales/<lang>/messages.json; Firefox picks the
 * browser's language and falls back to default_locale (en).
 */

/** The translated message, or the key itself if it's missing (so gaps show up instead of blanks). */
export function t(key: string, ...substitutions: (string | number)[]): string {
  return browser.i18n.getMessage(key, substitutions.map(String)) || key;
}

/**
 * Fills static markup: data-i18n sets the text, data-i18n-<attr> sets that
 * attribute (data-i18n-title, data-i18n-placeholder, data-i18n-aria-label).
 */
export function localizePage(root: ParentNode = document): void {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    for (const { name, value } of [...el.attributes]) {
      if (name === 'data-i18n') el.textContent = t(value);
      else if (name.startsWith('data-i18n-')) el.setAttribute(name.slice('data-i18n-'.length), t(value));
    }
  }
}
