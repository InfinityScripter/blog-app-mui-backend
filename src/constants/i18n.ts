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

/** A locale that gets translated + cached (every supported locale except `ru`). */
export type TranslatableLang = Exclude<Lang, typeof LANG.RU>;

/**
 * The locales the warmup translates into: all supported locales except the
 * original `ru`. Listed explicitly (not derived from Object.keys, which is typed
 * `string[]`) so it's a typed `TranslatableLang[]`. Add a locale = one more
 * entry here, in LANG, and in DEEPL_TARGET_BY_LANG.
 */
export const TRANSLATABLE_LANGS: readonly TranslatableLang[] = [LANG.EN];

/** DeepL language codes keyed by our locale. `ru` is source-only. */
export const DEEPL_SOURCE_LANG = 'RU';

export const DEEPL_TARGET_BY_LANG: Record<TranslatableLang, string> = {
  [LANG.EN]: 'EN-US',
};
