// Pure slugifier for model-release slugs. Vendor/model/version are latin, so no
// transliteration is needed: lowercase, collapse any non-alphanumeric run into a
// single hyphen, and trim leading/trailing hyphens.

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
