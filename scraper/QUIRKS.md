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

### Image locator anchored on a JS-only wrapper (agraria Magic Zoom)
- **Symptom:** after the placeholder fix above, agraria captured **no** image at
  all (`images: null`) — re-running extraction didn't help.
- **Cause:** the image locator was tagged (in the foreground) on
  `figure.mz-ready`, a wrapper Magic Zoom builds with JavaScript. Background
  capture tabs don't run that visibility-gated JS, so the wrapper is absent at
  extraction; the locator's class anchor and exact structural path can't resolve,
  the matcher falls back to scoring all `<img>`s, none clear the evidence gate
  (an attr-less img has no identifying signal once the path is shifted), and it
  returns null. The real main image is present the whole time as a plain
  `<img alt="Perfume Candle" src="…_600x.jpg">`.
- **Fix:** `findLocator` now runs a **last-resort second pass** when the normal
  pass finds nothing: `structuralTailOverlapTolerant` aligns the stored path to a
  candidate while permitting up to two inserted/removed wrapper segments (the
  shift a zoom/gallery/lightbox introduces). It still aligns the tail contiguously
  segment-for-segment with no substitutions, so unrelated branches score ~0.
  (`userscript/src/03-locator.js`, mirrored in `scripts/verify-recipes.mjs`.)
- **Invariants — do not loosen any of these, they were each load-bearing in
  testing:**
  - The tolerant pass runs **only when the normal pass returns null**
    (`allowTolerantPath`). Verified across 13 sites / 192 pages: 0 existing
    matches change, 16 agraria images recovered. Make it always-on and it
    re-ranks working matches.
  - It is **media-only** (`isMediaLocator`). For text fields a structurally-
    approximate match is just the wrong text (recovered "Regular price" for an
    accord, a reviews list for notes) — there, null beats a confident wrong
    answer. Images are the opposite: the approximate match is the right image.
  - **Never** use plain segment-LCS for this — repeated generic segments
    (`div:nth-of-type(1)…`) let a header logo share a long subsequence with a
    deep product image, and the logo won. Contiguous-with-bounded-indels is what
    discriminates.
  - The header logo losing to the product image also relies on the existing
    `isChromeRegion` (−8) / region scoring. Keep it.
- _Commit: (this change)_

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

## Browse grid detection

### Heterogeneous tiles fragment one grid (only the middle rows highlight)
- **Symptom:** on a browse page (aman), group detection highlighted only a subset
  of the product grid — "the middle two rows" — leaving the top and bottom rows
  un-highlightable, so those products never made the extract list.
- **Cause:** `detectRepeatedGroups` grouped a container's children by *exact*
  `elementItemSignature` and only admitted a signature seen ≥3 times. Real product
  grids are heterogeneous: the same logical tile carries **optional per-item
  tokens** — a personalisation flag, a `quick_view` marker, a missing size label, a
  cross-sell SKU list. One `<ul>` of 16 `li.product` split into 5 signature buckets
  (7 / 6 / 1 / 1 / 1); only the two ≥3 buckets formed groups and the user could
  select just one (7 members), so 9 tiles vanished.
- **Fix:** within each non-chrome container, cluster **same-tag** siblings by their
  *common identity* — tokens present in ≥50% of siblings — and widen the dominant
  exact-signature group onto any variant tile that shares ≥60% of that identity
  **and** passes `looksLikeProductMember`. Members still key on the dominant exact
  signature, so page-wide merging across layout blocks (Zara) is unchanged.
  `elementItemSignature` was refactored to expose its parts via
  `elementSignatureParts` for this. (`userscript/src/04-browse.js`,
  `userscript/src/02-dom-utils.js`.)
- **Invariants — each was load-bearing when verified across 11 site snapshots
  (product-grid URLs unchanged everywhere except the two under-detecting sites,
  aman 7→16 and aesop 7→10, with zero URLs lost):**
  - Widening is **skipped in chrome regions** (`isChromeRegion`). Without it, the
    overlap+product-like gate still admits nav entries ("All Decor", "REGISTRY"),
    inflating menu groups. Product grids live in main content; never widen chrome.
  - Widened (non-exact-match) members **must pass `looksLikeProductMember`**. The
    identity-overlap test alone lets a stray heading/promo sibling in; the
    product-like gate is what restricts widening to real tiles.
  - Widening requires a **genuine repeat first** (a signature seen ≥3 times in the
    bucket) before lumping, same trigger as the baseline — coincidental same-tag
    rows are not a grid.
  - Containers with no qualifying tag bucket fall back to the **exact-signature
    baseline**, so nothing that grouped before can stop grouping.
- **Enumeration must mirror detection.** The lock only persists the dominant exact
  `itemSignature`; the widened membership lives in the group, not the config. So
  `enumerateBrowseItems` (extraction) **re-runs `detectRepeatedGroups` and returns
  the matching group's members** instead of doing a page-wide
  `signature === itemSignature` match — otherwise it re-fragments the grid and the
  extract list shows only the exact-match subset (the "highlighted 16, extracted 7"
  bug). It falls back to the page-wide exact match if the saved key no longer maps to
  a detected group (page changed since lock), so it never enumerates nothing.
  (`userscript/src/03-locator.js`.)
- _Commit: (this change)_

---

## Element selection / tagging

### `click`-swallowing widgets couldn't be tagged (hover highlights, click does nothing)
- **Symptom:** on a product page (aman), one accordion's body content highlighted
  on hover but clicking it never opened the tag prompt — no console error, the
  element just wouldn't select. Other elements tagged fine.
- **Cause:** element picking listened on `click` (capture, document). Page-builder /
  editable widgets (the section was a Shogun `sd-simple-text` block with
  `data-edit-mode`) swallow the `click` for their own content — either a capture
  listener that stops it, or DOM that mutates between mousedown and mouseup so no
  `click` is ever synthesised. `mousemove` (the hover highlight) is untouched, so
  the element looked selectable but wasn't.
- **Fix:** pick on **`pointerdown`** (capture) instead of `click`. pointerdown fires
  before any click-swallowing and isn't gated on a matching mouseup, so every
  element the user can hover-highlight can be tagged. A primary-button guard
  (`event.button === 0`) keeps right/middle presses flowing to the page's native
  context menu. (`userscript/src/07-init.js`, `userscript/src/05-ui.js`.)
- **Invariant:** keep the primary-button guard — without it, a right-click both
  tags an element and (via preventDefault) suppresses the native context menu.
- _Commit: (this change)_

---

## Open / watch-list

- _(none currently)_
