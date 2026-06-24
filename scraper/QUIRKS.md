# Site quirks & fix history

A running log of the weird, site-specific behaviours the scraper has had to
accommodate — and **why the code is shaped the way it is**. The goal of this
file is institutional memory: when you see an odd-looking guard, branch, or
fallback in the scraper, it is almost certainly here, with the symptom that
forced it and the invariant it protects.

## How to use this file

- **Before deleting or "simplifying" a guard**, search here for it. If it has an
  entry, it earned its place by breaking a real site. Removing it regresses that
  site (and probably others sharing the quirk).
- **Before adding a fix**, read the related entries. The genericism rule
  (`CLAUDE.md`) is absolute: never special-case one host. Every fix below is
  conceptual — it changes how a *class* of behaviour is handled and is a no-op
  on sites that don't exhibit the quirk. Keep it that way.
- **After landing a fix**, add an entry. Keep it short: symptom → root cause →
  where the fix lives → the invariant (what must stay true / not break).

Each entry notes the originating commit so you can `git show <hash>` for the
full diff and reasoning.

---

## Images

### Lazy-load: real URL lives in `data-*`, not `src`
- **Symptom:** galleries on lazy-loading sites (Squarespace, lazysizes) saved no
  images during capture — e.g. only 1 of 34 adlan products got any.
- **Cause:** these libraries populate the live `src`/`currentSrc` only when the
  image scrolls into view. Background capture child tabs never scroll, so `src`
  was empty at extraction time; the real URL sat in `data-src` / `data-image` /
  `data-srcset`.
- **Fix:** `lazyImgUrl` (`userscript/src/03-locator.js`, mirrored in
  `scripts/verify-recipes.mjs`) falls back to the common lazy-load carriers when
  the live `src` is missing.
- **Invariant:** only used when the live `src` is absent/unusable, so it never
  overrides a genuinely loaded `src`. Generic across sites.
- _Commit: 96bd9f1_

### Lazy-load: `src` is a non-empty placeholder, not empty (agraria)
- **Symptom:** agraria (Shopify) captured exactly one "image" per candle that
  was a 1×1 transparent SVG — nothing real pulled through, despite the lazy-load
  fix above already existing.
- **Cause:** the prior fix only triggered when `src` was *falsy*. agraria seeds
  `src` with an inline `data:image/svg+xml,...` placeholder (truthy) and keeps
  the real URL in `data-src`. `lazyImgUrl` returned the truthy placeholder and
  never fell through.
- **Fix:** `isPlaceholderSrc` treats any `data:` URI (and empty) as "not a real
  image", so `lazyImgUrl` skips placeholders in `src`, `data-*`, and `srcset`,
  returning the placeholder only as a last resort
  (`userscript/src/03-locator.js`, mirrored in `scripts/verify-recipes.mjs`).
- **Invariant:** a normal loaded `src` is a real URL, not a `data:` URI, so this
  is a no-op there. This *extends* 96bd9f1 — do not collapse the two: the empty
  case and the placeholder case are distinct and both occur in the wild.
- _Commit: d402009_

### Lazy-load URL templates: protocol-relative + `{width}` placeholders
- **Symptom:** backend import rejected images as "Invalid url" — 22 of 27
  aerangis products failed to push.
- **Cause:** lazy CDNs (Shopify, etc.) store URLs in `data-src`/`data-srcset` as
  templates their own foreground loader resolves: protocol-relative (`//host/…`)
  and carrying an unresolved size placeholder (`…_{width}x.jpg`). Background tabs
  never run that loader, so we saved the raw template.
- **Fix:** `normalizeImageUrl` resolves `{width}`/`{height}` to a concrete size
  and makes the URL absolute. Applied at **two seams**: capture
  (`extractImageSrc`, for future scrapes) and the pipeline (push/assemble, so
  already-captured sites push without re-scraping). The pipeline drops any value
  that still isn't a usable absolute URL rather than failing the whole product —
  `source_url` is provenance only; image bytes ride as `data_base64`.
- **Invariant:** a normal loaded `src` is already absolute and placeholder-free,
  so this is a no-op. Keep both seams — they cover future vs already-captured.
- _Commit: 8b3e587_

### Image selection anchored on a wrapper (`<picture>`), not the `<img>`
- **Symptom:** every product got the **first** configured product's images —
  gardenia's `data.json` carried the oud product's image URLs.
- **Cause:** a saved image selection often anchors on a `<picture>` or wrapper,
  which has no `src`. Extraction read `{attribute:'src'}`, got null, and fell
  back to the **stale config-time URL**, stamping one product's images onto all.
- **Fix:** `extractImageSrc` resolves the live URL from whatever carrier the
  locator matched (img / picture's descendant img / `source` srcset /
  background-image) and the stale config-time fallback was **removed** — each
  product yields its own image, or none.
- **Invariant:** never reintroduce a config-time URL fallback for images. "No
  image" is correct; "the wrong product's image" is not.
- _Commit: 72d7f00_

### Tampermonkey blocked CDN image fetches
- **Symptom:** image metadata was posted but no image files ever downloaded.
- **Cause:** `@connect` only listed localhost/127.0.0.1, so Tampermonkey blocked
  the `GM_xmlhttpRequest` blob fetch to image CDNs (static.zara.net, etc.).
- **Fix:** `@connect *` in the userscript header — the scraper matches `*://*/*`
  and legitimately pulls images from arbitrary CDN hosts.
- **Invariant:** keep `@connect *`; narrowing it re-breaks every off-host CDN.
- _Commit: 72d7f00_

### Non-image downloads saved as `.jpg` (CDN 404 HTML pages)
- **Symptom:** ~44% of aerangis image files were "404: Page not found" HTML
  masquerading as `.jpg` — broken on the site, mostly secondary positions.
- **Cause:** a lazy-load URL that resolves to a CDN 404 still returns a body (an
  HTML error page). The userscript base64'd it and the server saved it as `.jpg`.
- **Fix:** guard at **every layer that handles image bytes**, trusting magic
  bytes over URL/extension: userscript `fetchImageBlob` rejects non-2xx /
  non-image content-type; server `/image` sniffs the buffer, rejects non-images
  (422), names the file by detected format; pipeline push skips non-image local
  files and sets `content_type` from the sniffed format. Recovery tool:
  `scripts/repair-images.mjs` re-downloads only broken files.
- **Invariant:** all three byte-handling layers must keep sniffing. Trust magic
  bytes, never the extension/URL.
- _Commit: 37ffc15_

---

## Locators (field extraction)

### Block-level text located by a drifting positional child
- **Symptom:** a description field captured "Allergens:" / "Pairings:" instead of
  the description, or returned null, across product templates of the same site.
- **Cause:** a text field tagged on an attribute-less element was located by a
  positional sub-path from its nearest stable ancestor (e.g.
  `p:nth-of-type(2)` under `.long_info`). Sites render the same block with
  different inner markup per template, so the index drifts onto the wrong child
  or finds nothing (e.g. `<div>` instead of `<p>`).
- **Fix:** two halves —
  - `buildLocator` (capture): when a recipe text field has no stable identity of
    its own and reaches its attributed ancestor only positionally, re-anchor on
    the block itself and capture its whole text; the LLM pass slices the field
    back out. Links/images keep their precise locator.
  - `findLocator` (extraction): existing configs whose positional sub-path no
    longer resolves fall back to the unambiguous anchor block instead of
    returning null.
- **Invariant:** the fallback fires only when the anchor is unambiguous **and**
  the sub-path failed entirely. Where the sub-path resolves to the *wrong* child,
  a re-tag is needed — do **not** silently "heal" that case. Applies to text
  only; links/images need their precise locator.
- _Commit: ec3e744_

---

## Scrape orchestration

### Self-reordered query strings broke result↔tab pairing
- **Symptom:** runs logged "0 ok / N failed" and "closed without result" even
  though `data.json` was written fine.
- **Cause:** product pages re-encode/reorder their own query string on load
  (`+` vs `%20`, `'` vs `%27`, param order), so the controller's exact-string
  match of a child tab's reported URL against the open set failed; the result was
  deleted and discarded.
- **Fix:** match results by a **normalized URL key** (canonical encoding, sorted
  params, no hash/trailing slash) everywhere the controller pairs results to
  tabs; log an unmatched result as a "stray" instead of dropping it.
- **Invariant:** never pair tabs/results by raw URL string equality — always via
  the normalized key. A run must never silently hide work that happened.
- _Commit: e834ce0_

---

## Open / watch-list

- **JS-generated locator anchors (agraria Magic Zoom).** agraria's image locator
  is anchored on `figure.mz-ready`, a wrapper Magic Zoom creates only after its
  JS runs — absent in background capture tabs, so the locator falls back to
  scoring all `<img>`s and can land on a placeholder/related-product image. The
  `data:` URI fix (d402009) mitigates it, but the robust fix is to avoid
  inferring locators anchored on volatile JS-generated wrappers (prefer the
  stable underlying `<img>`). Not yet done — re-tagging on the real `<img>` is
  the current workaround.
