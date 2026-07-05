// Content-translation i18n constants. `ru` is the original (never translated,
// never stored in post_translations); every other locale is machine-translated
// and cached. Adding a locale = one entry here + a DeepL target mapping.

export const LANG = {
  RU: 'ru',
  EN: 'en',
} as const;

export type Lang = (typeof LANG)[keyof typeof LANG];

/** The original locale: passthrough, no translation, byte-identical response. */
export const DEFAULT_LANG: Lang = LANG.RU;

const SUPPORTED_LANGS: readonly Lang[] = [LANG.RU, LANG.EN];

/**
 * Narrows an arbitrary query value to a supported Lang. Unknown/absent → the
 * default (`ru`). Per the contract we never 400 on a bad lang — degrade to
 * original instead.
 */
export function parseLang(raw: string | string[] | undefined): Lang {
  return SUPPORTED_LANGS.find((lang) => lang === raw) ?? DEFAULT_LANG;
}

/** DeepL language codes keyed by our locale. `ru` is source-only. */
export const DEEPL_SOURCE_LANG = 'RU';

export const DEEPL_TARGET_BY_LANG: Record<Exclude<Lang, typeof LANG.RU>, string> = {
  [LANG.EN]: 'EN-US',
};
