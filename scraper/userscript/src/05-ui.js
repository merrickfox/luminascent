
  function ensureUi() {
    if (shadowRoot) return;

    const host = document.createElement('div');
    host.id = 'lumiscrape-root';
    host.style.all = 'initial';
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      .panel {
        position: fixed;
        top: 16px;
        right: 16px;
        width: 340px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: #111827;
        color: #f9fafb;
        border: 1px solid #374151;
        border-radius: 12px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.35);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        z-index: 2147483646;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-shrink: 0;
        min-width: 0;
        padding: 12px 14px;
        border-bottom: 1px solid #374151;
        cursor: grab;
        user-select: none;
      }
      .header > div:first-child { min-width: 0; flex: 1; }
      .header .btn { flex-shrink: 0; }
      .header.dragging { cursor: grabbing; }
      .title { font-weight: 700; font-size: 14px; overflow-wrap: anywhere; }
      .subtle {
        color: #9ca3af;
        font-size: 12px;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .body > .status { flex-shrink: 0; }
      .mode-content {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .scroll-region {
        flex: 1;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        display: grid;
        gap: 10px;
        align-content: start;
      }
      .panel-actions {
        flex-shrink: 0;
        display: grid;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid #374151;
        background: #111827;
      }
      .tagging-zone {
        flex-shrink: 0;
        display: grid;
        gap: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid #374151;
        max-height: min(340px, 45vh);
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
      }
      .tagged-list-region {
        flex: 1;
        min-height: 60px;
      }
      .wrap-text { overflow-wrap: anywhere; word-break: break-word; }
      .btn {
        appearance: none;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        text-align: left;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .btn:hover { background: #374151; }
      .btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .btn:disabled:hover { background: #1f2937; }
      .btn.primary { background: #2563eb; border-color: #2563eb; }
      .btn.primary:hover { background: #1d4ed8; }
      .btn.active { outline: 2px solid #60a5fa; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      .list { display: grid; gap: 6px; }
      .item {
        border: 1px solid #374151;
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
        background: #0f172a;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .item:hover { border-color: #60a5fa; }
      .item.selected {
        border-color: #f59e0b;
        background: #1f2937;
        box-shadow: inset 0 0 0 1px #f59e0b;
      }
      .tag {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 999px;
        background: #374151;
        font-size: 11px;
        margin-right: 4px;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .field-card-header .tag { flex: 1; min-width: 0; }
      .context-menu {
        position: fixed;
        min-width: 220px;
        max-width: min(320px, calc(100vw - 16px));
        background: #111827;
        border: 1px solid #374151;
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        padding: 6px;
        z-index: 2147483647;
      }
      .context-item {
        padding: 8px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
      .context-item:hover { background: #1f2937; }
      .image-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .image-card {
        position: relative;
        border: 2px solid transparent;
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        background: #0f172a;
      }
      .image-card img { width: 100%; height: 80px; object-fit: cover; display: block; }
      .image-card.selected { border-color: #60a5fa; }
      .image-order {
        position: absolute;
        top: 4px;
        right: 4px;
        background: #2563eb;
        color: white;
        border-radius: 999px;
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        font-size: 11px;
        font-weight: 700;
      }
      .status {
        padding: 8px;
        background: #0f172a;
        border-radius: 8px;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .run-log {
        margin: 6px 0 0;
        padding: 8px;
        background: #0b1120;
        border: 1px solid #1e293b;
        border-radius: 8px;
        max-height: 160px;
        overflow-y: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        line-height: 1.5;
        color: #94a3b8;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .field-picker { display: grid; gap: 10px; max-height: 200px; overflow-x: hidden; overflow-y: auto; }
      .field-scope .row { margin-top: 4px; }
      .field-tag-btn { font-size: 12px; padding: 6px 8px; flex: 1 1 calc(50% - 4px); min-width: 0; max-width: 100%; }
      .tag-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
      .tag-actions .btn { font-size: 11px; padding: 4px 8px; flex: 1 1 auto; min-width: 0; }
      .field-card.active { border-color: #f59e0b; box-shadow: inset 0 0 0 1px #f59e0b; }
      .field-card.retagging { border-color: #60a5fa; box-shadow: inset 0 0 0 1px #60a5fa; }
      .field-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; min-width: 0; }
      .field-card-actions { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
      .field-card-actions .btn { font-size: 11px; padding: 2px 6px; }
      .field-card-actions .btn.danger { color: #fca5a5; border-color: #7f1d1d; }
      .context-item.danger { color: #fca5a5; }
      .context-item.danger:hover { background: #450a0a; }
      .containment-group { margin-top: 8px; padding-top: 8px; border-top: 1px solid #374151; }
      .containment-group.pending { background: #1f2937; border-radius: 6px; padding: 6px 8px; margin-top: 6px; }
      .containment-header { display: flex; justify-content: space-between; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
      .containment-header .btn { font-size: 11px; padding: 4px 8px; flex-shrink: 0; }
      .containment-list { display: grid; gap: 4px; margin-top: 4px; }
      .containment-entry { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; min-width: 0; }
      .containment-entry .btn { font-size: 11px; padding: 2px 6px; flex-shrink: 0; }
      .containment-entry .subtle { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
      .field-tag-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-top: 2px; min-width: 0; }
      .field-tag-row .btn { font-size: 11px; padding: 0 6px; flex-shrink: 0; }
      .field-tag-row .subtle { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
      .batch-size-row { display: flex; align-items: center; gap: 8px; }
      .extract-pick { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .extract-pick input { flex-shrink: 0; }
      .adhoc-sep { margin-top: 12px; text-align: center; opacity: 0.8; }
      .batch-size-input {
        width: 64px;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
        font: inherit;
      }
      .brand-input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
        font: inherit;
      }
      .brand-row { display: flex; align-items: center; gap: 8px; }
      .brand-row .brand-input { flex: 1; min-width: 0; }
      .autodetect-row {
        flex-shrink: 0;
        display: grid;
        gap: 6px;
        padding-bottom: 10px;
        border-bottom: 1px solid #374151;
      }
      .btn.danger { color: #fca5a5; border-color: #7f1d1d; }
      .btn.danger:hover { background: #450a0a; }
    `;
    shadowRoot.appendChild(style);

    panelEl = document.createElement('div');
    panelEl.className = 'panel';
    shadowRoot.appendChild(panelEl);
    setupPanelDrag();

    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu';
    contextMenuEl.style.display = 'none';
    shadowRoot.appendChild(contextMenuEl);

    GM_addStyle(`
      .lumiscrape-highlight {
        outline: 2px dashed #60a5fa !important;
        outline-offset: 2px !important;
      }
      .lumiscrape-highlight-strong {
        outline: 3px solid #f59e0b !important;
        outline-offset: 2px !important;
      }
      .lumiscrape-selectable-hover {
        outline: 2px dotted #34d399 !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
      .lumiscrape-highlight-auto {
        outline: 2px solid #a855f7 !important;
        outline-offset: 2px !important;
      }
    `);
  }

  function hideContextMenu() {
    contextMenuEl.style.display = 'none';
    contextMenuEl.innerHTML = '';
  }

  function showContextMenu(x, y, items) {
    contextMenuEl.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = `context-item${item.danger ? ' danger' : ''}`;
      row.textContent = item.label;
      row.addEventListener('click', (event) => {
        event.stopPropagation();
        hideContextMenu();
        item.onClick();
      });
      contextMenuEl.appendChild(row);
    });
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
    contextMenuEl.style.display = 'block';

    const rect = contextMenuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    contextMenuEl.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    contextMenuEl.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  }

  function setMode(mode) {
    state.mode = mode;
    clearHighlights();
    hideContextMenu();

    if (mode !== 'browse') {
      state.selectedBrowseGroupId = null;
      stopBrowseWatch();
      state.browseScanStatus = 'idle';
      clearHighlights();
    }

    if (mode === 'browse') {
      state.browseScanStatus = 'scanning';
      startBrowseWatch();
      runBrowseDetection();
    }

    if (mode === 'product') {
      ensureProductConfig();
      state.pendingTagElement = null;
      state.pendingTagPreview = '';
      state.pendingContainmentAdd = null;
      state.pendingRetagFieldKey = null;
      state.lastTaggedMessage = '';
      state.autoStatus = '';
    }

    if (mode === 'images') {
      state.imageCandidates = gatherImages();
      state.imageSelections = [...(state.config?.images || [])];
    }

    if (mode === 'extract') {
      state.extractRunning = !!getExtractState().active;
      state.adhocStatus = '';
    }

    renderPanel();
  }

  function ensureProductConfig() {
    if (!state.config) {
      state.config = {
        host: state.host,
        product: { fields: [] },
        images: [],
      };
    }
    if (!state.config.product) state.config.product = { fields: [] };
    if (!state.config.product.fields) state.config.product.fields = [];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function locatorSample(locator) {
    if (!locator) return '';
    return locator.textSample || locator.anchor || locator.tag || '';
  }

  function getPendingTagPreview(el) {
    if (!el) return '';
    const text = normalizeText(el.textContent);
    if (text) return text.slice(0, 80);
    if (el.tagName === 'IMG') {
      return `[image] ${normalizeText(el.getAttribute('alt') || el.getAttribute('src') || '')}`.slice(0, 80);
    }
    return `<${el.tagName.toLowerCase()}>`;
  }

  const CONTAINMENT_MODES = ['also_contains', 'sometimes_contains'];

  function containmentModeLabel(mode) {
    if (mode === 'also_contains') return 'Also contains';
    if (mode === 'sometimes_contains') return 'Sometimes contains';
    return String(mode || '').replace(/_/g, ' ');
  }

  function containmentEntryKey(entry) {
    if (typeof entry === 'string') return entry;
    if (entry?.fieldKey) return entry.fieldKey;
    return null;
  }

  function normalizeContainmentArray(arr) {
    return [...new Set((arr || []).map(containmentEntryKey).filter(Boolean))];
  }

  function getSchemaFieldLabel(fieldKey) {
    const schemaField = state.schema?.fields?.find((field) => field.key === fieldKey);
    return schemaField?.label || fieldKey;
  }

  function normalizeFieldEntry(field) {
    if (!field) return field;
    field.also_contains = normalizeContainmentArray(field.also_contains);
    field.sometimes_contains = normalizeContainmentArray(field.sometimes_contains);
    if (field.containment) delete field.containment;

    // Migrate the legacy single `locator` shape to a `locators` array. Each
    // entry is one tag and captures raw text/attribute independently.
    if (!Array.isArray(field.locators)) {
      field.locators = field.locator ? [field.locator] : [];
    }
    if (field.locator) delete field.locator;
    if (field.extraction) delete field.extraction;

    return field;
  }

  function getFieldLocators(field) {
    if (!field) return [];
    if (Array.isArray(field.locators)) return field.locators.filter(Boolean);
    return field.locator ? [field.locator] : [];
  }

  function getTaggedField(fieldKey) {
    const field = (state.config?.product?.fields || []).find((item) => item.fieldKey === fieldKey);
    return field ? normalizeFieldEntry(field) : null;
  }

  function startContainmentAdd(fieldKey, mode) {
    const field = getTaggedField(fieldKey);
    if (!field || state.pendingRetagFieldKey) return;
    hideContextMenu();
    state.pendingContainmentAdd = { fieldKey, mode };
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = '';
    renderPanel();
  }

  function cancelContainmentAdd() {
    state.pendingContainmentAdd = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    clearHighlights();
    renderPanel();
  }

  function startRetagField(fieldKey) {
    if (!getTaggedField(fieldKey)) return;
    hideContextMenu();
    state.pendingRetagFieldKey = fieldKey;
    state.pendingAddTagFieldKey = null;
    state.pendingContainmentAdd = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = '';
    clearHighlights();
    renderPanel();
  }

  function startAddTag(fieldKey) {
    if (!getTaggedField(fieldKey)) return;
    hideContextMenu();
    state.pendingAddTagFieldKey = fieldKey;
    state.pendingRetagFieldKey = null;
    state.pendingContainmentAdd = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = '';
    clearHighlights();
    renderPanel();
  }

  function cancelAddTag() {
    state.pendingAddTagFieldKey = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    clearHighlights();
    renderPanel();
  }

  function cancelRetagField() {
    state.pendingRetagFieldKey = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    clearHighlights();
    renderPanel();
  }

  function deleteTaggedField(fieldKey, options = {}) {
    if (!fieldKey) return;
    ensureProductConfig();

    const label = getSchemaFieldLabel(fieldKey);
    if (!options.skipConfirm
      && !window.confirm(`Delete "${label}" (${fieldKey})? Its tags and containment links will be removed.`)) {
      return;
    }

    hideContextMenu();
    const fields = state.config.product.fields
      .filter((field) => field.fieldKey !== fieldKey)
      .map((field) => {
        const next = { ...field };
        normalizeFieldEntry(next);
        next.also_contains = (next.also_contains || []).filter((key) => key !== fieldKey);
        next.sometimes_contains = (next.sometimes_contains || []).filter((key) => key !== fieldKey);
        return next;
      });

    state.config.product = { ...state.config.product, fields };

    if (state.pendingRetagFieldKey === fieldKey) {
      state.pendingRetagFieldKey = null;
    }
    if (state.pendingContainmentAdd?.fieldKey === fieldKey) {
      state.pendingContainmentAdd = null;
    }
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = `Deleted ${label}. Click an element to tag it again.`;
    clearHighlights();
    renderPanel();
  }

  function getContainmentCandidates(parentFieldKey, mode) {
    const parent = getTaggedField(parentFieldKey);
    if (!parent) return [];
    const existing = new Set(parent[mode] || []);
    return (state.schema?.fields || [])
      .filter((field) => field.scope !== 'image')
      .filter((field) => field.key !== parentFieldKey)
      .filter((field) => !existing.has(field.key));
  }

  function renderContainmentFieldPicker(parentFieldKey, mode) {
    const candidates = getContainmentCandidates(parentFieldKey, mode);
    if (!candidates.length) {
      return '<div class="subtle">No more schema fields available to add.</div>';
    }

    const scopeLabels = {
      product: 'Product',
      size: 'Size / Price',
      note: 'Notes',
      accord: 'Accords',
    };
    const scopes = ['product', 'size', 'note', 'accord'];

    return scopes
      .map((scope) => {
        const scopeFields = candidates.filter((field) => field.scope === scope);
        if (!scopeFields.length) return '';
        const buttons = scopeFields
          .map(
            (field) => `
              <button
                class="btn field-tag-btn"
                data-containment-pick="${parentFieldKey}"
                data-containment-mode="${mode}"
                data-field-key="${field.key}"
                title="${field.key}"
              >${field.label}</button>
            `,
          )
          .join('');
        return `
          <div class="field-scope">
            <div class="subtle">${scopeLabels[scope] || scope}</div>
            <div class="row">${buttons}</div>
          </div>
        `;
      })
      .join('');
  }

  function renderContainmentGroup(field, mode) {
    normalizeFieldEntry(field);
    const tags = field[mode] || [];
    const isPending = state.pendingContainmentAdd?.fieldKey === field.fieldKey
      && state.pendingContainmentAdd?.mode === mode;
    const items = tags
      .map(
        (containedKey, index) => `
          <div class="containment-entry">
            <span class="tag">${containedKey}</span>
            <span class="subtle">${getSchemaFieldLabel(containedKey)}</span>
            <button class="btn" data-remove-containment="${field.fieldKey}" data-containment-mode="${mode}" data-containment-index="${index}">×</button>
          </div>
        `,
      )
      .join('');

    return `
      <div class="containment-group ${isPending ? 'pending' : ''}">
        <div class="containment-header">
          <span class="subtle">${containmentModeLabel(mode)}</span>
          <button
            class="btn ${isPending ? 'active' : ''}"
            data-add-containment="${field.fieldKey}"
            data-containment-mode="${mode}"
            ${(state.pendingContainmentAdd && !isPending) || state.pendingRetagFieldKey ? 'disabled' : ''}
          >${isPending ? 'Pick field…' : '+ Add field'}</button>
        </div>
        ${items ? `<div class="containment-list">${items}</div>` : ''}
      </div>
    `;
  }

  function renderProductFieldPicker() {
    const schemaFields = (state.schema?.fields || []).filter((field) => field.scope !== 'image');
    if (!schemaFields.length) {
      return '<div class="status">Schema not loaded. Is the local server running?</div>';
    }

    if (state.pendingContainmentAdd) {
      const { fieldKey, mode } = state.pendingContainmentAdd;
      return `
        <div class="status">
          <strong>${fieldKey}</strong> → ${containmentModeLabel(mode)}
        </div>
        <div class="subtle">Pick a schema field that ${containmentModeLabel(mode).toLowerCase()} inside this region:</div>
        <div class="field-picker">${renderContainmentFieldPicker(fieldKey, mode)}</div>
        <button class="btn" id="lumiscrape-cancel-containment">Cancel</button>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    if (state.pendingRetagFieldKey) {
      const label = getSchemaFieldLabel(state.pendingRetagFieldKey);
      return `
        <div class="status">
          Re-tagging <strong>${label}</strong> (<code>${state.pendingRetagFieldKey}</code>)
        </div>
        <div class="subtle">Click the correct element on the page. This replaces all current tags; containment links are kept.</div>
        <button class="btn" id="lumiscrape-cancel-retag">Cancel</button>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    if (state.pendingAddTagFieldKey) {
      const label = getSchemaFieldLabel(state.pendingAddTagFieldKey);
      return `
        <div class="status">
          Adding a tag to <strong>${label}</strong> (<code>${state.pendingAddTagFieldKey}</code>)
        </div>
        <div class="subtle">Click another element on the page that also holds this field's data.</div>
        <button class="btn" id="lumiscrape-cancel-addtag">Cancel</button>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    if (!state.pendingTagElement) {
      return `
        <div class="status">Click an element on the page to tag a new field.</div>
        <div class="subtle">On each tagged field card, use Also/Sometimes contains to link other schema fields.</div>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    const preview = state.pendingTagPreview || getPendingTagPreview(state.pendingTagElement);
    const scopeLabels = {
      product: 'Product',
      size: 'Size / Price',
      note: 'Notes',
      accord: 'Accords',
    };

    const scopes = ['product', 'size', 'note', 'accord'];
    const fieldButtons = scopes
      .map((scope) => {
        const scopeFields = schemaFields.filter((field) => field.scope === scope);
        if (!scopeFields.length) return '';
        const buttons = scopeFields
          .map(
            (field) => `
              <button class="btn field-tag-btn" data-field-key="${field.key}" title="${field.key}">
                ${field.label}
              </button>
            `,
          )
          .join('');
        return `
          <div class="field-scope">
            <div class="subtle">${scopeLabels[scope] || scope}</div>
            <div class="row">${buttons}</div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="status wrap-text"><strong>Selected:</strong> ${escapeHtml(preview) || '(element)'}</div>
      <div class="subtle">Choose a field to tag:</div>
      <div class="field-picker">${fieldButtons}</div>
      <button class="btn" id="lumiscrape-clear-tag-selection">Clear selection</button>
      ${state.lastTaggedMessage ? `<div class="status wrap-text">${escapeHtml(state.lastTaggedMessage)}</div>` : ''}
    `;
  }

  function setupPanelDrag() {
    if (!panelEl || panelEl.dataset.dragBound) return;
    panelEl.dataset.dragBound = '1';

    panelEl.addEventListener('mousedown', (e) => {
      const header = e.target.closest('.header');
      if (!header || !panelEl.contains(header)) return;
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea')) return;

      e.preventDefault();
      const rect = panelEl.getBoundingClientRect();
      panelEl.style.right = 'auto';
      panelEl.style.left = `${rect.left}px`;
      panelEl.style.top = `${rect.top}px`;

      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      header.classList.add('dragging');

      function onMove(ev) {
        const maxX = window.innerWidth - panelEl.offsetWidth;
        const maxY = window.innerHeight - panelEl.offsetHeight;
        const x = Math.max(0, Math.min(maxX, ev.clientX - offsetX));
        const y = Math.max(0, Math.min(maxY, ev.clientY - offsetY));
        panelEl.style.left = `${x}px`;
        panelEl.style.top = `${y}px`;
      }

      function onUp() {
        header.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function renderPanel() {
    if (!panelEl) return;

    const browseDone = !!state.config?.browse;
    const fieldsCount = state.config?.product?.fields?.length || 0;
    const imagesCount = state.config?.images?.length || 0;

    panelEl.innerHTML = `
      <div class="header">
        <div>
          <div class="title">Luminascent Scraper</div>
          <div class="subtle">${state.host}</div>
        </div>
        <button class="btn" id="lumiscrape-minimize">—</button>
      </div>
      <div class="body">
        <div class="status wrap-text">
          ${state.hasConfig ? 'Configured' : 'Not configured'} ·
          Browse ${browseDone ? '✓' : '—'} ·
          Fields ${fieldsCount} ·
          Images ${imagesCount}
        </div>
        <div class="mode-content">
          ${renderModeBody()}
        </div>
      </div>
    `;

    panelEl.querySelector('#lumiscrape-minimize')?.addEventListener('click', () => {
      panelEl.style.display = panelEl.style.display === 'none' ? 'block' : 'none';
    });

    bindPanelEvents();
  }

  function renderModeBody() {
    if (state.mode === 'start') {
      if (!state.hasConfig) {
        return `
          <input class="brand-input" id="lumiscrape-brand" type="text" placeholder="Brand (optional)" />
          <div class="subtle">Names the local data folder and the brand stored in the database. Leave blank for multi-brand retailers — the brand is then derived from the site host.</div>
          <button class="btn primary" id="lumiscrape-configure">Configure for scraping</button>
          <div class="subtle">Creates the site folder on the local scraper server.</div>
          <button class="btn" id="lumiscrape-exclude">Exclude this site</button>
          <div class="subtle">Hides the scraper on this site permanently. Re-enable by clearing the userscript's stored values.</div>
        `;
      }

      const brandName = state.config?.brand?.name || '';
      return `
        <div class="row">
          <button class="btn" data-mode="browse">Browse mode</button>
          <button class="btn" data-mode="product">Product mode</button>
          <button class="btn" data-mode="images">Images mode</button>
          <button class="btn" data-mode="extract">Extract mode</button>
        </div>
        <div class="subtle">Workflow: browse → product → images → extract</div>
        <div class="brand-row">
          <input class="brand-input" id="lumiscrape-brand" type="text" placeholder="Brand (optional)" value="${escapeHtml(brandName)}" />
          <button class="btn" id="lumiscrape-save-brand">Save brand</button>
        </div>
        <div class="subtle">${brandName ? `Folder locked to “${escapeHtml(state.config?.siteSlug || state.config?.hostSlug || '')}”. Editing the brand updates the database name only.` : 'Add a brand to set the database name. The data folder keeps its current name.'}</div>
        <button class="btn" id="lumiscrape-exclude">Exclude this site</button>
        <div class="subtle">Hides the scraper on this site permanently. Re-enable by clearing the userscript's stored values.</div>
      `;
    }

    if (state.mode === 'browse') {
      const items = state.browseCandidates
        .map(
          (group, index) => `
            <div class="item ${group.id === state.selectedBrowseGroupId ? 'selected' : ''}" data-group-index="${index}">
              <div><span class="tag">${group.count} items</span><span class="tag">score ${group.score}</span></div>
              <div class="wrap-text">${escapeHtml(group.sampleText) || '(no sample text)'}</div>
            </div>
          `,
        )
        .join('');

      return `
        <div class="scroll-region">
          <div class="subtle">Hover to preview. Click a group to select it, then lock.</div>
          <div class="status" id="lumiscrape-browse-status">${browseStatusText()}</div>
          <button class="btn" id="lumiscrape-detect-groups">Detect groups now</button>
          <div class="subtle">Auto-watches for late-loaded content (API grids, infinite scroll).</div>
          <div class="list">${items || '<div class="subtle">No groups detected yet.</div>'}</div>
        </div>
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-lock-browse" ${state.selectedBrowseGroupId ? '' : 'disabled'}>
            Lock selected group
          </button>
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    if (state.mode === 'product') {
      const pendingBusy = state.pendingContainmentAdd
        || state.pendingRetagFieldKey
        || state.pendingAddTagFieldKey
        || state.pendingTagElement;

      const tagged = (state.config?.product?.fields || [])
        .map((field) => {
          normalizeFieldEntry(field);
          const isActiveCard = state.pendingContainmentAdd?.fieldKey === field.fieldKey;
          const isRetagging = state.pendingRetagFieldKey === field.fieldKey;
          const isAdding = state.pendingAddTagFieldKey === field.fieldKey;
          const cardClass = [
            'item',
            'field-card',
            isActiveCard ? 'active' : '',
            (isRetagging || isAdding) ? 'retagging' : '',
          ].filter(Boolean).join(' ');

          const locators = getFieldLocators(field);
          const tagsList = locators
            .map((locator, index) => `
              <div class="field-tag-row">
                <span class="subtle">${index + 1}. ${escapeHtml(locatorSample(locator)) || '(element)'}</span>
                <button
                  class="btn"
                  data-remove-locator="${field.fieldKey}"
                  data-locator-index="${index}"
                  ${pendingBusy ? 'disabled' : ''}
                  title="Remove this tag"
                >×</button>
              </div>
            `)
            .join('');

          return `
            <div class="${cardClass}" data-field-card="${field.fieldKey}">
              <div class="field-card-header">
                <span class="tag">${field.fieldKey}${locators.length > 1 ? ` ·${locators.length}` : ''}</span>
                <div class="field-card-actions">
                  <button
                    class="btn"
                    data-addtag-field="${field.fieldKey}"
                    ${pendingBusy ? 'disabled' : ''}
                  >Add tag</button>
                  <button
                    class="btn"
                    data-retag-field="${field.fieldKey}"
                    ${pendingBusy ? 'disabled' : ''}
                  >Re-tag</button>
                  <button
                    class="btn danger"
                    data-delete-field="${field.fieldKey}"
                    ${state.pendingContainmentAdd || state.pendingRetagFieldKey || state.pendingAddTagFieldKey ? 'disabled' : ''}
                  >Delete</button>
                </div>
              </div>
              ${tagsList || '<div class="subtle">(no tags)</div>'}
              ${renderContainmentGroup(field, 'also_contains')}
              ${renderContainmentGroup(field, 'sometimes_contains')}
            </div>
          `;
        })
        .join('');

      const productInstructions = state.pendingRetagFieldKey
        ? `Click an element on the page to re-tag <strong>${getSchemaFieldLabel(state.pendingRetagFieldKey)}</strong> (replaces all its tags).`
        : state.pendingAddTagFieldKey
        ? `Click an element to add another tag to <strong>${getSchemaFieldLabel(state.pendingAddTagFieldKey)}</strong>.`
        : state.pendingContainmentAdd
        ? `Pick a schema field for <strong>${state.pendingContainmentAdd.fieldKey}</strong> → ${containmentModeLabel(state.pendingContainmentAdd.mode)}.`
        : '1. Click an element to tag a field · 2. Add more tags or link related fields · 3. Save';

      const autoBusy = !!state.autoDetecting;
      const fieldCount = (state.config?.product?.fields || []).length;
      return `
        <div class="autodetect-row">
          <button class="btn primary" id="lumiscrape-autodetect" ${pendingBusy || autoBusy ? 'disabled' : ''}>
            ${autoBusy ? 'Auto-detecting…' : '✨ Auto-detect fields'}
          </button>
          <div class="subtle">Best-effort detection with the local LLM. Fills only untagged fields — review, edit or delete before saving.</div>
          ${state.autoStatus ? `<div class="status wrap-text">${escapeHtml(state.autoStatus)}</div>` : ''}
        </div>
        <div class="tagging-zone">
          <div class="subtle">${productInstructions}</div>
          ${renderProductFieldPicker()}
        </div>
        <div class="scroll-region tagged-list-region">
          <div class="subtle">Tagged fields (${fieldCount}) · Add tag / Re-tag / Delete on each card, or right-click for options</div>
          <div class="list">${tagged || '<div class="subtle">No fields tagged yet.</div>'}</div>
        </div>
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-save-product">Save product blueprint</button>
          <button class="btn danger" id="lumiscrape-clear-fields" ${fieldCount && !autoBusy ? '' : 'disabled'}>Clear all fields</button>
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    if (state.mode === 'images') {
      const cards = state.imageCandidates
        .map((image) => {
          const selected = state.imageSelections.find((sel) => sel.src === image.src);
          return `
            <div class="image-card ${selected ? 'selected' : ''}" data-image-id="${image.id}">
              <img src="${image.src}" alt="" />
              ${selected ? `<div class="image-order">${selected.order}</div>` : ''}
            </div>
          `;
        })
        .join('');

      return `
        <div class="subtle">Click images to assign order. Click again to remove.</div>
        <div class="scroll-region">
          <div class="image-grid">${cards || '<div class="subtle">No images found.</div>'}</div>
        </div>
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-save-images">Save image selections</button>
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    if (state.mode === 'extract') {
      const items = collectProductItems();
      state.extractItems = items;
      const deselected = getExtractDeselected();
      const selectedCount = items.filter((item) => !deselected.has(item.url)).length;
      const extractState = getExtractState();
      const extractionActive = !!extractState.active;
      const modeLocked = extractController && extractionActive;
      const hasProductBlueprint = !!state.config?.product?.fields?.length;
      const batchControls = state.extractMode === 'batch'
        ? `
          <label class="subtle batch-size-row">
            Tabs per batch
            <input
              type="number"
              id="lumiscrape-batch-size"
              class="batch-size-input"
              min="1"
              value="${state.extractBatchSize}"
              ${modeLocked ? 'disabled' : ''}
            />
          </label>
          <label class="subtle batch-size-row">
            Gap between tabs (s)
            <input
              type="number"
              id="lumiscrape-batch-gap"
              class="batch-size-input"
              min="0"
              step="0.5"
              value="${state.extractGapSeconds}"
              ${modeLocked ? 'disabled' : ''}
            />
          </label>
          <div class="subtle">0 = open the whole batch at once.</div>
        `
        : '';

      const refineList = state.extractRefineOpen
        ? `
          <div class="row">
            <button class="btn" id="lumiscrape-select-all" ${modeLocked ? 'disabled' : ''}>Select all</button>
            <button class="btn" id="lumiscrape-select-none" ${modeLocked ? 'disabled' : ''}>Select none</button>
          </div>
          <div class="scroll-region">
            <div class="list">
              ${items
                .map(
                  (item, index) => `
                    <label class="item extract-pick" data-extract-index="${index}">
                      <input
                        type="checkbox"
                        data-extract-url="${escapeHtml(item.url)}"
                        ${deselected.has(item.url) ? '' : 'checked'}
                        ${modeLocked ? 'disabled' : ''}
                      />
                      <span class="wrap-text">${escapeHtml(item.label) || escapeHtml(shortUrl(item.url))}</span>
                    </label>
                  `,
                )
                .join('') || '<div class="subtle">No products detected.</div>'}
            </div>
          </div>
        `
        : '';

      return `
        <div class="subtle" id="lumiscrape-extract-count">${selectedCount} of ${items.length} products selected from browse grid.</div>
        ${items.length
          ? `<button class="btn" id="lumiscrape-toggle-refine" ${modeLocked ? 'disabled' : ''}>${state.extractRefineOpen ? 'Hide selection' : 'Refine selection'}</button>`
          : ''}
        ${refineList}
        <div class="subtle">Extraction mode</div>
        <div class="row">
          <button
            type="button"
            id="lumiscrape-extract-mode-all"
            class="btn ${state.extractMode === 'all' ? 'active' : ''}"
            ${modeLocked ? 'disabled' : ''}
          >All at once</button>
          <button
            type="button"
            id="lumiscrape-extract-mode-batch"
            class="btn ${state.extractMode === 'batch' ? 'active' : ''}"
            ${modeLocked ? 'disabled' : ''}
          >Batched</button>
        </div>
        ${batchControls}
        <div class="status" id="lumiscrape-extract-status">${extractionActive ? 'Running…' : 'Idle'}</div>
        ${renderRunLog(extractState)}
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-run-extract" ${selectedCount && !extractionActive ? '' : 'disabled'}>
            Start extraction
          </button>
          <button class="btn" id="lumiscrape-stop-extract" ${extractionActive ? '' : 'disabled'}>Stop extraction</button>
        </div>
        <div class="subtle adhoc-sep">— or extract just this page (no browse needed) —</div>
        <button class="btn" id="lumiscrape-extract-this-page" ${hasProductBlueprint && !extractionActive ? '' : 'disabled'}>
          Extract this page
        </button>
        <div class="status" id="lumiscrape-adhoc-status">${escapeHtml(state.adhocStatus || (hasProductBlueprint ? 'Scrapes the current page using the saved product blueprint.' : 'Tag a product blueprint first (Product mode).'))}</div>
        <div class="panel-actions">
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    return '';
  }

  function renderRunLog(extractState) {
    const log = extractState?.log || [];
    if (!log.length) return '';
    const lines = log.slice(-15).reverse().map((line) => escapeHtml(line)).join('\n');
    return `<pre class="run-log" id="lumiscrape-run-log">${lines}</pre>`;
  }

  function bindPanelEvents() {
    panelEl.querySelector('#lumiscrape-configure')?.addEventListener('click', async () => {
      const brand = panelEl.querySelector('#lumiscrape-brand')?.value.trim() || null;
      await saveConfig({
        host: state.host,
        version: 1,
        createdAt: new Date().toISOString(),
        brand,
        browse: null,
        product: { fields: [] },
        images: [],
      });
      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-save-brand')?.addEventListener('click', async () => {
      const brand = panelEl.querySelector('#lumiscrape-brand')?.value.trim() || null;
      await saveConfig({ brand });
    });

    panelEl.querySelector('#lumiscrape-exclude')?.addEventListener('click', () => {
      excludeHost(state.host);
      shadowRoot?.host?.remove();
      shadowRoot = null;
      panelEl = null;
    });

    panelEl.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.getAttribute('data-mode')));
    });

    panelEl.querySelector('#lumiscrape-detect-groups')?.addEventListener('click', () => {
      runBrowseDetection();
    });

    panelEl.querySelectorAll('[data-group-index]').forEach((itemEl) => {
      const index = Number(itemEl.getAttribute('data-group-index'));
      itemEl.addEventListener('mouseenter', () => {
        const group = state.browseCandidates[index];
        if (group) showBrowseHighlights(group);
      });
      itemEl.addEventListener('mouseleave', () => {
        if (state.mode === 'browse') restoreBrowseHighlights();
      });
      itemEl.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const group = state.browseCandidates[index];
        selectBrowseGroup(group);
        updateBrowseSelectionUi();
      });
    });

    panelEl.querySelector('#lumiscrape-lock-browse')?.addEventListener('click', async () => {
      const group = getSelectedBrowseGroup();
      if (!group) return;

      const linkSamples = group.members.map(resolveLinkFromItem);
      const hrefCount = linkSamples.filter((sample) => sample.type === 'href' || sample.type === 'data-href').length;
      const jsCount = linkSamples.filter((sample) => sample.type === 'js-click').length;
      const linkRule = group.linkRule || buildLinkRule(group.members);

      await saveConfig({
        browse: {
          container: group.containerRecipe || buildContainerRecipe(group.container),
          itemSignature: group.itemSignature || group.typeFingerprint,
          itemFingerprint: group.typeFingerprint,
          linkRule: {
            ...linkRule,
            strategy: hrefCount >= jsCount ? 'href' : 'js-click',
          },
          fingerprint: group.fingerprint,
          linkStrategy: hrefCount >= jsCount ? 'href' : 'js-click',
          lockedAt: new Date().toISOString(),
          _debug: {
            count: group.count,
            sampleText: group.sampleText,
          },
        },
      });

      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-save-product')?.addEventListener('click', async () => {
      ensureProductConfig();
      await saveConfig({ product: state.config.product });
      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-autodetect')?.addEventListener('click', () => {
      runAutoDetect();
    });

    panelEl.querySelector('#lumiscrape-clear-fields')?.addEventListener('click', () => {
      clearAllProductFields();
    });

    panelEl.querySelectorAll('[data-field-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fieldKey = btn.getAttribute('data-field-key');
        const field = state.schema?.fields?.find((item) => item.key === fieldKey);
        if (field && state.pendingTagElement) {
          tagField(field, state.pendingTagElement);
        }
      });
    });

    panelEl.querySelector('#lumiscrape-clear-tag-selection')?.addEventListener('click', () => {
      state.pendingTagElement = null;
      state.pendingTagPreview = '';
      clearHighlights();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-cancel-containment')?.addEventListener('click', () => {
      cancelContainmentAdd();
    });

    panelEl.querySelector('#lumiscrape-cancel-retag')?.addEventListener('click', () => {
      cancelRetagField();
    });

    panelEl.querySelector('#lumiscrape-cancel-addtag')?.addEventListener('click', () => {
      cancelAddTag();
    });

    panelEl.querySelectorAll('[data-retag-field]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startRetagField(btn.getAttribute('data-retag-field'));
      });
    });

    panelEl.querySelectorAll('[data-addtag-field]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startAddTag(btn.getAttribute('data-addtag-field'));
      });
    });

    panelEl.querySelectorAll('[data-remove-locator]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeFieldLocator(
          btn.getAttribute('data-remove-locator'),
          Number(btn.getAttribute('data-locator-index')),
        );
      });
    });

    panelEl.querySelectorAll('[data-delete-field]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteTaggedField(btn.getAttribute('data-delete-field'), { skipConfirm: true });
      });
    });

    panelEl.querySelectorAll('[data-add-containment]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startContainmentAdd(
          btn.getAttribute('data-add-containment'),
          btn.getAttribute('data-containment-mode'),
        );
      });
    });

    panelEl.querySelectorAll('[data-remove-containment]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeContainmentTag(
          btn.getAttribute('data-remove-containment'),
          btn.getAttribute('data-containment-mode'),
          Number(btn.getAttribute('data-containment-index')),
        );
      });
    });

    panelEl.querySelectorAll('[data-containment-pick]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        addContainmentField(
          btn.getAttribute('data-containment-pick'),
          btn.getAttribute('data-containment-mode'),
          btn.getAttribute('data-field-key'),
        );
      });
    });

    panelEl.querySelectorAll('[data-field-card]').forEach((card) => {
      // Hovering a tagged field card highlights its live element(s) on the page so the
      // user can see what each tag points at. Skip while a tagging flow is mid-pick so we
      // don't fight the selectable/pending highlight already on the page.
      const fieldKeyForHover = card.getAttribute('data-field-card');
      card.addEventListener('mouseenter', () => {
        if (state.pendingContainmentAdd
          || state.pendingTagElement
          || state.pendingRetagFieldKey
          || state.pendingAddTagFieldKey) return;
        const field = (state.config?.product?.fields || [])
          .find((item) => item.fieldKey === fieldKeyForHover);
        if (!field) return;
        const els = getFieldLocators(field)
          .map((locator) => findLocator(locator, document))
          .filter(Boolean);
        if (els.length) highlightElements(els, true);
      });
      card.addEventListener('mouseleave', () => {
        if (state.pendingContainmentAdd
          || state.pendingTagElement
          || state.pendingRetagFieldKey
          || state.pendingAddTagFieldKey) return;
        clearHighlights();
      });

      card.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.pendingContainmentAdd
          || state.pendingTagElement
          || state.pendingRetagFieldKey
          || state.pendingAddTagFieldKey) return;
        const fieldKey = card.getAttribute('data-field-card');
        if (!fieldKey) return;
        const rect = card.getBoundingClientRect();
        showContextMenu(rect.right - 8, rect.top + 8, [
          {
            label: 'Add another tag…',
            onClick: () => startAddTag(fieldKey),
          },
          {
            label: 'Re-tag field (replace all)…',
            onClick: () => startRetagField(fieldKey),
          },
          {
            label: 'Add also contains field…',
            onClick: () => startContainmentAdd(fieldKey, 'also_contains'),
          },
          {
            label: 'Add sometimes contains field…',
            onClick: () => startContainmentAdd(fieldKey, 'sometimes_contains'),
          },
          {
            label: 'Delete field…',
            danger: true,
            onClick: () => deleteTaggedField(fieldKey),
          },
        ]);
      });
    });

    panelEl.querySelectorAll('[data-image-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-image-id');
        const image = state.imageCandidates.find((item) => item.id === id);
        if (!image) return;

        const existingIndex = state.imageSelections.findIndex((sel) => sel.src === image.src);
        if (existingIndex >= 0) {
          const removedOrder = state.imageSelections[existingIndex].order;
          state.imageSelections.splice(existingIndex, 1);
          state.imageSelections = state.imageSelections
            .sort((a, b) => a.order - b.order)
            .map((sel, idx) => ({ ...sel, order: idx + 1 }));
          if (removedOrder <= state.imageSelections.length) {
            state.imageSelections = state.imageSelections.map((sel) => ({
              ...sel,
              order: sel.order > removedOrder ? sel.order - 1 : sel.order,
            }));
          }
        } else {
          state.imageSelections.push({
            order: state.imageSelections.length + 1,
            src: image.src,
            locator: image.locator,
            kind: image.kind,
          });
        }

        renderPanel();
      });
    });

    panelEl.querySelector('#lumiscrape-save-images')?.addEventListener('click', async () => {
      await saveConfig({
        images: state.imageSelections.sort((a, b) => a.order - b.order),
      });
      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-extract-mode-all')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setExtractMode('all');
    });

    panelEl.querySelector('#lumiscrape-extract-mode-batch')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setExtractMode('batch');
    });

    panelEl.querySelector('#lumiscrape-batch-size')?.addEventListener('change', (event) => {
      const value = parseInt(event.target.value, 10);
      state.extractBatchSize = Math.max(1, Number.isNaN(value) ? 5 : value);
      saveExtractPrefs();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-batch-gap')?.addEventListener('change', (event) => {
      const value = parseFloat(event.target.value);
      state.extractGapSeconds = Math.max(0, Number.isNaN(value) ? 0 : value);
      saveExtractPrefs();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-run-extract')?.addEventListener('click', () => {
      startExtraction();
    });

    panelEl.querySelector('#lumiscrape-stop-extract')?.addEventListener('click', () => {
      stopExtraction();
    });

    panelEl.querySelector('#lumiscrape-toggle-refine')?.addEventListener('click', () => {
      state.extractRefineOpen = !state.extractRefineOpen;
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-select-all')?.addEventListener('click', () => {
      getExtractDeselected().clear();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-select-none')?.addEventListener('click', () => {
      const deselected = getExtractDeselected();
      (state.extractItems || []).forEach((item) => deselected.add(item.url));
      renderPanel();
    });

    panelEl.querySelectorAll('[data-extract-url]').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const url = event.target.getAttribute('data-extract-url');
        const deselected = getExtractDeselected();
        if (event.target.checked) deselected.delete(url);
        else deselected.add(url);
        updateExtractSelectionUi();
      });
    });

    panelEl.querySelectorAll('.extract-pick[data-extract-index]').forEach((rowEl) => {
      const index = Number(rowEl.getAttribute('data-extract-index'));
      rowEl.addEventListener('mouseenter', () => {
        const item = (state.extractItems || [])[index];
        if (item?.element) highlightElements([item.element], true);
      });
      rowEl.addEventListener('mouseleave', () => {
        if (state.mode === 'extract') clearHighlights();
      });
    });

    panelEl.querySelector('#lumiscrape-extract-this-page')?.addEventListener('click', () => {
      extractCurrentPage();
    });
  }

  function getElementFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (shadowRoot && (target === shadowRoot.host || shadowRoot.contains(target))) return null;
    return target;
  }

  function onProductClick(event) {
    if (state.mode !== 'product') return;
    if (state.pendingContainmentAdd) return;

    const el = getElementFromEvent(event);
    if (!el) return;

    event.preventDefault();
    event.stopPropagation();

    if (state.pendingRetagFieldKey) {
      const schemaField = state.schema?.fields?.find((field) => field.key === state.pendingRetagFieldKey);
      if (!schemaField) {
        state.lastTaggedMessage = `Schema field "${state.pendingRetagFieldKey}" not found.`;
        state.pendingRetagFieldKey = null;
        renderPanel();
        return;
      }
      highlightElements([el], true);
      tagField(schemaField, el, { retag: true });
      return;
    }

    if (state.pendingAddTagFieldKey) {
      const schemaField = state.schema?.fields?.find((field) => field.key === state.pendingAddTagFieldKey);
      if (!schemaField) {
        state.lastTaggedMessage = `Schema field "${state.pendingAddTagFieldKey}" not found.`;
        state.pendingAddTagFieldKey = null;
        renderPanel();
        return;
      }
      highlightElements([el], true);
      tagField(schemaField, el, { append: true });
      return;
    }

    state.pendingTagElement = el;
    state.pendingTagPreview = getPendingTagPreview(el);
    state.selectedElement = el;
    highlightElements([el], true);
    renderPanel();
  }

  function tagField(field, el, options = {}) {
    if (state.pendingContainmentAdd) return;
    ensureProductConfig();
    const locator = buildLocator(el);

    const fields = [...state.config.product.fields];
    const existingIndex = fields.findIndex((item) => item.fieldKey === field.key);
    const append = !!options.append && existingIndex >= 0;
    const isRetag = !append && (options.retag || existingIndex >= 0);

    let message;
    if (existingIndex >= 0) {
      const existing = normalizeFieldEntry({ ...fields[existingIndex] });
      // append: add another tag/locator. retag or re-tag of an existing field:
      // replace the whole locator set. Containment links are always preserved.
      const locators = append ? [...getFieldLocators(existing), locator] : [locator];
      fields[existingIndex] = {
        ...existing,
        scope: field.scope,
        type: field.type,
        locators,
        taggedAt: new Date().toISOString(),
      };
      message = append
        ? `Added another tag to ${field.label} (${locators.length} total). Click the next element.`
        : `Re-tagged ${field.label}. Click the next element.`;
    } else {
      fields.push({
        fieldKey: field.key,
        scope: field.scope,
        type: field.type,
        locators: [locator],
        also_contains: [],
        sometimes_contains: [],
        taggedAt: new Date().toISOString(),
      });
      message = `Tagged as ${field.label}. Click the next element.`;
    }

    state.config.product = { ...state.config.product, fields };
    state.pendingContainmentAdd = null;
    state.pendingRetagFieldKey = null;
    state.pendingAddTagFieldKey = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = message;
    clearHighlights();
    renderPanel();
  }

  function removeFieldLocator(fieldKey, index) {
    if (!fieldKey || Number.isNaN(index)) return;
    ensureProductConfig();
    const fields = [...state.config.product.fields];
    const fieldIndex = fields.findIndex((item) => item.fieldKey === fieldKey);
    if (fieldIndex < 0) return;

    const field = normalizeFieldEntry({ ...fields[fieldIndex] });
    const locators = getFieldLocators(field).filter((_, i) => i !== index);

    if (!locators.length) {
      // Removing the last tag deletes the field entirely (and its inbound links).
      deleteTaggedField(fieldKey, { skipConfirm: true });
      return;
    }

    fields[fieldIndex] = { ...field, locators };
    state.config.product = { ...state.config.product, fields };
    renderPanel();
  }

  function addContainmentField(parentFieldKey, mode, containedFieldKey) {
    if (!CONTAINMENT_MODES.includes(mode) || !containedFieldKey) return;
    if (parentFieldKey === containedFieldKey) return;
    ensureProductConfig();

    const parentIndex = state.config.product.fields.findIndex((field) => field.fieldKey === parentFieldKey);
    if (parentIndex < 0) return;

    const fields = [...state.config.product.fields];
    const parentField = { ...fields[parentIndex] };
    normalizeFieldEntry(parentField);

    if ((parentField[mode] || []).includes(containedFieldKey)) {
      cancelContainmentAdd();
      return;
    }

    parentField[mode] = [...(parentField[mode] || []), containedFieldKey];
    fields[parentIndex] = parentField;
    state.config.product = { ...state.config.product, fields };
    state.pendingContainmentAdd = null;
    state.lastTaggedMessage = `Linked ${getSchemaFieldLabel(containedFieldKey)} to ${parentFieldKey} (${containmentModeLabel(mode)}).`;
    renderPanel();
  }

  function removeContainmentTag(fieldKey, mode, index) {
    if (!CONTAINMENT_MODES.includes(mode) || Number.isNaN(index)) return;
    ensureProductConfig();

    const parentIndex = state.config.product.fields.findIndex((field) => field.fieldKey === fieldKey);
    if (parentIndex < 0) return;

    const fields = [...state.config.product.fields];
    const parentField = { ...fields[parentIndex] };
    normalizeFieldEntry(parentField);
    parentField[mode] = (parentField[mode] || []).filter((_, i) => i !== index);
    fields[parentIndex] = parentField;
    state.config.product = { ...state.config.product, fields };
    renderPanel();
  }
