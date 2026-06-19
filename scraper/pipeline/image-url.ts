/**
 * Normalize a captured image source URL into a valid absolute URL.
 *
 * CDN URLs read from lazy-load templates are often unusable verbatim: protocol-relative
 * (`//host/...`, no scheme) or carrying an unresolved size placeholder — Shopify ships
 * `..._{width}x.jpg` in data-src and only substitutes a concrete width once its own
 * loader runs in the foreground, which a background capture tab never triggers. The
 * backend's import schema requires `source_url` to be a valid absolute URL, so these
 * are rejected even though the image content itself rides along as base64.
 *
 * Resolve placeholders to a concrete size and supply a scheme for protocol-relative
 * URLs. `source_url` is provenance only (content travels as data_base64), so anything
 * that still isn't a usable absolute URL is dropped (returns undefined) rather than
 * failing the whole product import. Generic across CDNs — a normal absolute URL is
 * returned unchanged.
 */
export function normalizeImageSourceUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let url = String(raw).trim();
  if (!url) return undefined;

  url = url.replace(/\{width\}/gi, '1024').replace(/\{height\}/gi, '1024');
  if (url.startsWith('//')) url = `https:${url}`;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    /* not a usable absolute URL */
  }
  return undefined;
}
