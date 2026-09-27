import { en } from './locales/en';
import { de } from './locales/de';

export type Language = 'en' | 'de';
export type TranslationKey = keyof typeof en;
export type LevelId = 'jelly' | 'bubbles' | 'aquarium' | 'railway' | 'fire' | 'airplane' | 'plant';
export const LANGUAGE_STORAGE_KEY = 'jelly-studio.language';
export const dictionaries = { en, de };

export function readLanguage(storage: Pick<Storage, 'getItem'>): Language {
  try {
    return storage.getItem(LANGUAGE_STORAGE_KEY) === 'de' ? 'de' : 'en';
  } catch {
    return 'en';
  }
}

export function saveLanguage(
  language: Language,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): boolean {
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, language);
    return storage.getItem(LANGUAGE_STORAGE_KEY) === language;
  } catch {
    return false;
  }
}

export function getLanguage(): Language {
  // Accessing localStorage itself can throw in restricted browser contexts.
  try {
    return readLanguage(window.localStorage);
  } catch {
    return 'en';
  }
}

const language = getLanguage();
type ParametersIn<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ParametersIn<Rest>
  : never;
type TranslationArgs<K extends TranslationKey> = [ParametersIn<(typeof en)[K]>] extends [never]
  ? [params?: undefined]
  : [params: Record<ParametersIn<(typeof en)[K]>, string | number>];

export function translate<K extends TranslationKey>(
  locale: Language,
  key: K,
  ...args: TranslationArgs<K>
): string {
  const params = args[0] as Record<string, string | number> | undefined;
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    params && name in params ? String(params[name]) : placeholder,
  );
}

export function t<K extends TranslationKey>(key: K, ...args: TranslationArgs<K>): string {
  return translate(language, key, ...args);
}

export function initializeLanguage(level: LevelId) {
  document.documentElement.lang = language;
  document.title = t(`page.${level}`);
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('description'));
}

/** Mount independently of WebGL so language remains available on graphics errors. */
export function mountLanguageSelector(root: HTMLElement) {
  const header = root.querySelector<HTMLElement>('.studio-header');
  if (!header || header.querySelector('#language-select')) return;
  let actions = header.querySelector<HTMLElement>('.header-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'header-actions header-language-actions';
    const note = header.lastElementChild;
    if (note && !note.classList.contains('level-nav')) actions.append(note);
    header.append(actions);
  }
  const control = document.createElement('div');
  control.className = 'language-control';
  const label = document.createElement('label');
  label.htmlFor = 'language-select';
  label.textContent = 'Language / Sprache';
  const select = document.createElement('select');
  select.id = 'language-select';
  select.setAttribute('aria-describedby', 'language-hint');
  select.title = t('language.restart');
  for (const [value, name] of [
    ['en', 'English'],
    ['de', 'Deutsch'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.lang = value;
    option.textContent = name;
    select.append(option);
  }
  select.value = language;
  const hint = document.createElement('span');
  hint.id = 'language-hint';
  hint.className = 'language-hint';
  hint.setAttribute('role', 'status');
  hint.textContent = t('language.restart');
  select.addEventListener('change', () => {
    const next = select.value;
    if (next === language) return;
    if (next !== 'en' && next !== 'de') {
      select.value = language;
      return;
    }
    let saved = false;
    try {
      saved = saveLanguage(next, window.localStorage);
    } catch {
      /* Storage access can be blocked. Keep the current scene usable. */
    }
    if (saved) location.reload();
    else {
      select.value = language;
      hint.textContent = t('language.unavailable');
      hint.classList.add('language-error');
    }
  });
  control.append(label, select, hint);
  actions.append(control);
}
