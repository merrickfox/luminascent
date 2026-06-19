
  // Auto-detect builds a compact, indexed outline of the live page and hands it to the
  // local LLM (via the server), which picks which candidate index holds each schema
  // field. We then resolve index -> live element -> buildLocator, so the result is shaped
  // identically to a hand-tagged field. The model only classifies from a closed list of
  // indices, so every answer maps back to a real element — no invented selectors/paths.

  const AUTODETECT_MAX_CANDIDATES = 500;
  const AUTODETECT_SNIPPET_LEN = 140;
  const AUTODETECT_SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'svg', 'path', 'template', 'head', 'link',
    'meta', 'br', 'hr', 'source', 'track', 'iframe', 'canvas', 'input', 'select',
    'textarea', 'option',
  ]);
  // Block containers worth surfacing whole (description / notes blocks) when they hold a
  // paragraph's worth of text but aren't sprawling page wrappers.
  const AUTODETECT_BLOCK_TAGS = new Set(['div', 'section', 'article', 'ul', 'ol', 'dl', 'blockquote']);
  const AUTODETECT_CONTENT_UNIT_TAGS = new Set(['p', 'li', 'dd', 'h1', 'h2', 'h3', 'h4']);

  function autodetectDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue;
    }
    return normalizeText(text);
  }

  function autodetectHasSemanticMarker(el) {
    if (!el.attributes) return false;
    if (el.getAttribute('itemprop') || el.getAttribute('role')) return true;
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-')) return true;
    }
    return false;
  }

  function isAutodetectCandidate(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (!tag || AUTODETECT_SKIP_TAGS.has(tag)) return false;
    if (!isVisible(el)) return false;
    if (isChromeRegion(el)) return false;

    if (autodetectDirectText(el).length >= 2) return true;
    if (AUTODETECT_CONTENT_UNIT_TAGS.has(tag)) {
      return normalizeText(el.textContent).length >= 2;
    }
    if (AUTODETECT_BLOCK_TAGS.has(tag)) {
      // Surface a text block (likely description / notes) but never a big layout wrapper.
      const textLen = normalizeText(el.textContent).length;
      const descendants = el.querySelectorAll('*').length;
      return textLen >= 30 && textLen <= 2000 && descendants <= 12;
    }
    return autodetectHasSemanticMarker(el) && normalizeText(el.textContent).length >= 2;
  }

  function describeAutodetectCandidate(el, index) {
    const tag = el.tagName.toLowerCase();
    let head = `[${index}] ${tag}`;

    const classes = Array.from(el.classList || [])
      .filter((token) => !isLumiscrapeToken(token))
      .slice(0, 3);
    if (classes.length) head += `.${classes.join('.')}`;

    const id = el.getAttribute && el.getAttribute('id');
    if (id && id.length <= 40) head += `#${id}`;

    const itemprop = el.getAttribute && el.getAttribute('itemprop');
    if (itemprop) head += `@${itemprop}`;
    const role = el.getAttribute && el.getAttribute('role');
    if (role) head += `[role=${role}]`;

    const text = (autodetectDirectText(el) || normalizeText(el.textContent)).slice(0, AUTODETECT_SNIPPET_LEN);
    return `${head} "${text}"`;
  }

  // Returns { lines, elements, truncated }. `elements[i]` is the live element for the
  // candidate written as `[i]` in `lines` — the index is the contract with the model.
  function buildDetectionOutline(root) {
    const scope = root || document.body;
    const candidates = [];
    const all = scope.querySelectorAll('*');
    for (const el of all) {
      if (isAutodetectCandidate(el)) candidates.push(el);
    }

    let ordered = candidates;
    let truncated = false;
    if (candidates.length > AUTODETECT_MAX_CANDIDATES) {
      // Keep main-content candidates first so a token cap never drops the product fields.
      const main = candidates.filter((el) => isMainContentRegion(el));
      const rest = candidates.filter((el) => !isMainContentRegion(el));
      ordered = [...main, ...rest].slice(0, AUTODETECT_MAX_CANDIDATES);
      truncated = true;
    }

    const lines = ordered.map((el, index) => describeAutodetectCandidate(el, index));
    return { lines, elements: ordered, truncated };
  }

  // Distinct purple outline so a freshly auto-detected set reads differently from a
  // manual blue/amber selection. Tracked in state.highlightEls so clearHighlights wipes it.
  function highlightAutoElements(elements) {
    clearHighlights();
    elements.forEach((el) => {
      if (!el) return;
      el.classList.add('lumiscrape-highlight-auto');
      state.highlightEls.push(el);
    });
  }

  function autodetectFieldKeysPresent() {
    return new Set((state.config?.product?.fields || []).map((field) => field.fieldKey));
  }

  // Turn one detected field into the same entry shape `tagField` produces, resolving each
  // candidate index to a live element and running the shared `buildLocator`. Returns the
  // entry plus the resolved elements (for highlighting), or null if nothing resolved.
  function buildAutodetectFieldEntry(detected, elements) {
    const schemaField = state.schema?.fields?.find((field) => field.key === detected.fieldKey);
    if (!schemaField) return null;

    const resolvedEls = [];
    const locators = [];
    (detected.candidateIndices || []).forEach((index) => {
      const el = elements[index];
      if (!el) return;
      const locator = buildLocator(el);
      if (!locator) return;
      resolvedEls.push(el);
      locators.push(locator);
    });
    if (!locators.length) return null;

    const known = new Set((state.schema?.fields || []).map((field) => field.key));
    const filterKeys = (keys) =>
      [...new Set((keys || []).filter((key) => known.has(key) && key !== detected.fieldKey))];

    return {
      entry: {
        fieldKey: detected.fieldKey,
        scope: schemaField.scope,
        type: schemaField.type,
        locators,
        also_contains: filterKeys(detected.also_contains),
        sometimes_contains: filterKeys(detected.sometimes_contains),
        auto: true,
        taggedAt: new Date().toISOString(),
      },
      elements: resolvedEls,
    };
  }

  async function runAutoDetect() {
    if (state.autoDetecting) return;
    ensureProductConfig();

    state.autoDetecting = true;
    state.autoStatus = 'Analysing page with the local LLM… this can take a moment.';
    renderPanel();

    try {
      // One pass yields the lines we send and the matching element refs we resolve
      // against — indices are the contract between them, so they must come from the
      // same build.
      const { lines, elements, truncated } = buildDetectionOutline(document.body);

      if (!lines.length) {
        state.autoStatus = 'No candidate elements found on this page.';
        state.autoDetecting = false;
        renderPanel();
        return;
      }

      const response = await apiPost('/auto-detect', {
        host: state.host,
        outline: lines,
      });

      const detectedFields = response?.fields || [];
      const present = autodetectFieldKeysPresent();
      const highlightEls = [];
      let added = 0;
      let skipped = 0;

      const fields = [...state.config.product.fields];
      detectedFields.forEach((detected) => {
        // Fill-only-untagged: never clobber a field the user already tagged or edited.
        if (present.has(detected.fieldKey)) {
          skipped += 1;
          return;
        }
        const built = buildAutodetectFieldEntry(detected, elements);
        if (!built) return;
        fields.push(built.entry);
        present.add(detected.fieldKey);
        highlightEls.push(...built.elements);
        added += 1;
      });

      state.config.product = { ...state.config.product, fields };

      if (highlightEls.length) highlightAutoElements(highlightEls);

      const parts = [];
      parts.push(added ? `Detected ${added} field${added === 1 ? '' : 's'} — review and save.` : 'No new fields detected.');
      if (skipped) parts.push(`${skipped} already tagged (kept).`);
      if (truncated) parts.push('Page was large; only the main region was analysed.');
      state.autoStatus = parts.join(' ');
    } catch (err) {
      state.autoStatus = `Auto-detect failed: ${err.message || err}. Is the local server and Ollama running?`;
    } finally {
      state.autoDetecting = false;
      renderPanel();
    }
  }

  function clearAllProductFields() {
    ensureProductConfig();
    if (!state.config.product.fields.length) return;
    if (!window.confirm('Clear all tagged fields and start from scratch?')) return;
    state.config.product = { ...state.config.product, fields: [] };
    state.autoStatus = 'Cleared all fields.';
    clearHighlights();
    renderPanel();
  }
