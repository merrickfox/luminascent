// ==UserScript==
// @name         Luminascent Scraper
// @namespace    https://luminascent.local/scraper
// @version      1.0.0
// @description  Blueprint-driven visual scraper for product sites
// @author       Luminascent
// @match        *://*/*
// @connect      localhost
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SERVER = 'http://127.0.0.1:8777';
  const SCRAPE_HASH = '#lumiscrape=1';
  const EXTRACT_KEY = 'lumiscrape_extract_state';
  const MAX_CONCURRENT_TABS = 3;

  const state = {
    mode: 'start',
    host: location.hostname,
    schema: null,
    config: null,
    hasConfig: false,
    browseCandidates: [],
    hoveredCandidate: null,
    highlightEls: [],
    selectedElement: null,
    pendingContainmentParent: null,
    imageCandidates: [],
    imageSelections: [],
    extractRunning: false,
  };

  let shadowRoot = null;
  let panelEl = null;
  let highlightLayer = null;
  let contextMenuEl = null;
  let mutationObserver = null;

  const STABLE_ATTRS = [
    'id',
    'name',
    'role',
    'aria-label',
    'itemprop',
    'data-testid',
    'data-test',
    'data-product-id',
    'data-sku',
    'data-id',
  ];

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || { 'Content-Type': 'application/json' },
        data: options.data,
        responseType: options.responseType || 'text',
        onload(response) {
          resolve(response);
        },
        onerror(error) {
          reject(error);
        },
      });
    });
  }

  async function apiGet(path) {
    const response = await gmRequest({ url: `${SERVER}${path}` });
    if (response.status >= 400) {
      const err = new Error(`GET ${path} failed (${response.status})`);
      err.status = response.status;
      err.body = response.responseText;
      throw err;
    }
    return JSON.parse(response.responseText);
  }

  async function apiPost(path, body) {
    const response = await gmRequest({
      method: 'POST',
      url: `${SERVER}${path}`,
      data: JSON.stringify(body),
    });
    if (response.status >= 400) {
      throw new Error(`POST ${path} failed (${response.status}): ${response.responseText}`);
    }
    return JSON.parse(response.responseText);
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getStableAttributes(el) {
    const attrs = {};
    if (!el || !el.attributes) return attrs;

    for (const attr of STABLE_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) attrs[attr] = value;
    }

    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && !attrs[attr.name]) {
        attrs[attr.name] = attr.value;
      }
    }

    return attrs;
  }

  function elementFingerprint(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const attrs = getStableAttributes(el);
    const attrKeys = Object.keys(attrs).sort().slice(0, 4);
    const attrPart = attrKeys.map((k) => `${k}=${attrs[k]}`).join('|');
    const childTags = Array.from(el.children)
      .slice(0, 6)
      .map((child) => child.tagName.toLowerCase())
      .join(',');
    return `${tag}[${attrPart}]{${childTags}}`;
  }

  function getNthOfType(el) {
    if (!el || !el.parentElement) return 1;
    const tag = el.tagName;
    let index = 1;
    for (const sibling of el.parentElement.children) {
      if (sibling.tagName === tag) {
        if (sibling === el) return index;
        index += 1;
      }
    }
    return 1;
  }

  function findStableAncestor(el, maxDepth = 8) {
    let current = el;
    let depth = 0;
    while (current && current !== document.body && depth < maxDepth) {
      const attrs = getStableAttributes(current);
      if (attrs.id || Object.keys(attrs).some((k) => k.startsWith('data-'))) {
        return { element: current, attrs };
      }
      current = current.parentElement;
      depth += 1;
    }
    return { element: document.body, attrs: {} };
  }

  function buildStructuralPath(el) {
    const segments = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.body && depth < 12) {
      const tag = current.tagName.toLowerCase();
      const nth = getNthOfType(current);
      segments.unshift(`${tag}:nth-of-type(${nth})`);
      current = current.parentElement;
      depth += 1;
    }

    return segments.join(' > ');
  }

  function findNearbyLabel(el) {
    if (!el) return null;

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return normalizeText(labelEl.textContent);
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return normalizeText(ariaLabel);

    if (el.id) {
      const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label) return normalizeText(label.textContent);
    }

    let sibling = el.previousElementSibling;
    let hops = 0;
    while (sibling && hops < 3) {
      const text = normalizeText(sibling.textContent);
      if (text && text.length <= 80) return text;
      sibling = sibling.previousElementSibling;
      hops += 1;
    }

    let parent = el.parentElement;
    hops = 0;
    while (parent && hops < 4) {
      const heading = parent.querySelector('h1,h2,h3,h4,h5,h6,dt,label,strong');
      if (heading && heading !== el && !el.contains(heading)) {
        const text = normalizeText(heading.textContent);
        if (text && text.length <= 80) return text;
      }
      parent = parent.parentElement;
      hops += 1;
    }

    return null;
  }

  function inferExtraction(el) {
    if (!el) return { type: 'text' };
    const tag = el.tagName.toLowerCase();

    if (tag === 'img') {
      return {
        type: 'attribute',
        attribute: el.currentSrc || el.src ? 'src' : 'currentSrc',
      };
    }

    if (tag === 'a' && el.href) {
      return { type: 'attribute', attribute: 'href' };
    }

    if (tag === 'meta' && el.content) {
      return { type: 'attribute', attribute: 'content' };
    }

    return { type: 'text' };
  }

  function buildLocator(el) {
    if (!el) return null;

    const stable = findStableAncestor(el);
    const attrs = getStableAttributes(el);
    const anchor = findNearbyLabel(el);
    const textSample = normalizeText(el.textContent).slice(0, 120);
    const extraction = inferExtraction(el);

    return {
      version: 1,
      tag: el.tagName.toLowerCase(),
      attrs,
      anchor,
      textSample,
      structuralPath: buildStructuralPath(el),
      anchorPath: stable.element === document.body ? null : buildStructuralPath(stable.element),
      anchorAttrs: stable.attrs,
      relativePathFromAnchor: stable.element === document.body
        ? buildStructuralPath(el)
        : buildRelativePath(stable.element, el),
      extraction,
      signals: {
        tag: el.tagName.toLowerCase(),
        attrs,
        anchor,
        textSample,
        structuralPath: buildStructuralPath(el),
      },
    };
  }

  function buildRelativePath(root, target) {
    const segments = [];
    let current = target;

    while (current && current !== root && current !== document.body) {
      segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${getNthOfType(current)})`);
      current = current.parentElement;
    }

    return segments.join(' > ');
  }

  function queryByAttrs(root, attrs) {
    if (!attrs || !Object.keys(attrs).length) return [];
    const selectors = [];

    if (attrs.id) {
      selectors.push(`#${cssEscape(attrs.id)}`);
    }

    const dataPairs = Object.entries(attrs).filter(([key]) => key.startsWith('data-') || key === 'itemprop' || key === 'role' || key === 'name');
    if (dataPairs.length) {
      const selector = dataPairs
        .slice(0, 3)
        .map(([key, value]) => `[${key}="${cssEscape(value)}"]`)
        .join('');
      selectors.push(`${root === document ? '' : ''}${selector}`);
    }

    const results = new Set();
    for (const selector of selectors) {
      try {
        root.querySelectorAll(selector).forEach((el) => results.add(el));
      } catch {
        /* ignore invalid selectors */
      }
    }

    return Array.from(results);
  }

  function scoreLocatorMatch(candidate, locator) {
    if (!candidate || !locator) return 0;
    let score = 0;

    if (locator.tag && candidate.tagName.toLowerCase() === locator.tag) score += 2;

    const candidateAttrs = getStableAttributes(candidate);
    const targetAttrs = locator.attrs || {};
    for (const [key, value] of Object.entries(targetAttrs)) {
      if (candidateAttrs[key] === value) score += 4;
    }

    if (locator.anchor) {
      const nearby = findNearbyLabel(candidate);
      if (nearby && nearby.toLowerCase() === locator.anchor.toLowerCase()) score += 5;
      else if (nearby && nearby.toLowerCase().includes(locator.anchor.toLowerCase())) score += 2;
    }

    if (locator.textSample) {
      const text = normalizeText(candidate.textContent);
      if (text === locator.textSample) score += 4;
      else if (text.includes(locator.textSample) || locator.textSample.includes(text)) score += 2;
    }

    if (locator.structuralPath) {
      const currentPath = buildStructuralPath(candidate);
      const targetParts = locator.structuralPath.split(' > ').slice(-3);
      const currentParts = currentPath.split(' > ').slice(-3);
      const overlap = targetParts.filter((part, idx) => currentParts[idx] === part).length;
      score += overlap;
    }

    if (isVisible(candidate)) score += 1;

    return score;
  }

  function findLocator(locator, root = document) {
    if (!locator) return null;

    const candidates = new Set();

    queryByAttrs(root, locator.attrs).forEach((el) => candidates.add(el));

    if (locator.anchor) {
      root.querySelectorAll('h1,h2,h3,h4,h5,h6,label,dt,strong,span,p').forEach((el) => {
        const text = normalizeText(el.textContent);
        if (text && text.toLowerCase().includes(locator.anchor.toLowerCase())) {
          let sibling = el.nextElementSibling;
          if (sibling) candidates.add(sibling);
          if (el.parentElement) {
            Array.from(el.parentElement.children).forEach((child) => candidates.add(child));
          }
        }
      });
    }

    if (locator.tag) {
      root.querySelectorAll(locator.tag).forEach((el) => candidates.add(el));
    }

    if (locator.relativePathFromAnchor && locator.anchorAttrs) {
      const anchors = queryByAttrs(root, locator.anchorAttrs);
      for (const anchorEl of anchors) {
        try {
          const found = anchorEl.querySelector(locator.relativePathFromAnchor.replace(/ > /g, ' > '));
          if (found) candidates.add(found);
        } catch {
          /* ignore */
        }
      }
    }

    let best = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = scoreLocatorMatch(candidate, locator);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore >= 4 ? best : null;
  }

  function extractValue(el, extraction) {
    if (!el) return null;
    const rule = extraction || inferExtraction(el);

    if (rule.type === 'attribute') {
      const attr = rule.attribute || 'href';
      if (attr === 'src' || attr === 'currentSrc') {
        return el.currentSrc || el.src || el.getAttribute('src') || null;
      }
      return el.getAttribute(attr);
    }

    return normalizeText(el.textContent);
  }

  function clearHighlights() {
    state.highlightEls.forEach((el) => {
      el.classList.remove('lumiscrape-highlight');
      el.classList.remove('lumiscrape-highlight-strong');
    });
    state.highlightEls = [];
  }

  function highlightElements(elements, strong = false) {
    clearHighlights();
    elements.forEach((el) => {
      if (!el) return;
      el.classList.add(strong ? 'lumiscrape-highlight-strong' : 'lumiscrape-highlight');
      state.highlightEls.push(el);
    });
  }

  function detectRepeatedGroups() {
    const groups = new Map();

    document.querySelectorAll('ul, ol, div, section, main, article, tbody').forEach((container) => {
      if (!isVisible(container)) return;

      const children = Array.from(container.children).filter((child) => isVisible(child));
      if (children.length < 3) return;

      const fingerprintCounts = new Map();
      children.forEach((child) => {
        const fp = elementFingerprint(child);
        fingerprintCounts.set(fp, (fingerprintCounts.get(fp) || 0) + 1);
      });

      for (const [fp, count] of fingerprintCounts.entries()) {
        if (count < 3) continue;

        const members = children.filter((child) => elementFingerprint(child) === fp);
        const links = members.flatMap((member) => Array.from(member.querySelectorAll('a[href], button, [role="link"], [onclick]')));
        const hrefLinks = links.filter((link) => link.href && !link.href.startsWith('javascript:'));

        let score = count;
        if (hrefLinks.length >= count) score += 8;
        else if (links.length >= count) score += 4;

        const sampleText = normalizeText(members[0]?.textContent || '').slice(0, 60);
        const key = `${container.tagName.toLowerCase()}::${fp}`;

        groups.set(key, {
          id: key,
          container,
          members,
          fingerprint: fp,
          count,
          score,
          sampleText,
          containerLocator: buildLocator(container),
          itemLocator: buildLocator(members[0]),
        });
      }
    });

    return Array.from(groups.values()).sort((a, b) => b.score - a.score).slice(0, 12);
  }

  function resolveLinkFromItem(itemEl) {
    if (!itemEl) return { type: 'none', url: null, element: null };

    const anchor = itemEl.querySelector('a[href]') || (itemEl.matches('a[href]') ? itemEl : null);
    if (anchor && anchor.href && !anchor.href.startsWith('javascript:')) {
      return { type: 'href', url: anchor.href, element: anchor };
    }

    const clickable = itemEl.querySelector('[role="link"], button, [onclick]') || itemEl;
    if (clickable) {
      const dataHref = clickable.getAttribute('data-href') || clickable.getAttribute('href');
      if (dataHref && !dataHref.startsWith('javascript:')) {
        return { type: 'data-href', url: new URL(dataHref, location.href).href, element: clickable };
      }
      return { type: 'js-click', url: null, element: clickable };
    }

    return { type: 'none', url: null, element: null };
  }

  function collectProductUrls() {
    const browse = state.config?.browse;
    if (!browse) return [];

    const container = findLocator(browse.containerLocator) || browse.containerLocator?.containerElement;
    const root = container || document;
    const members = browse.membersSample
      ? browse.membersSample.map((locator) => findLocator(locator, root)).filter(Boolean)
      : [];

    let items = members;
    if (!items.length && browse.itemLocator) {
      const itemMatch = findLocator(browse.itemLocator, root);
      if (itemMatch && itemMatch.parentElement) {
        const fp = elementFingerprint(itemMatch);
        items = Array.from(itemMatch.parentElement.children).filter(
          (child) => elementFingerprint(child) === fp,
        );
      }
    }

    if (!items.length && browse.containerLocator) {
      const foundContainer = findLocator(browse.containerLocator);
      if (foundContainer) {
        items = Array.from(foundContainer.children).filter(isVisible);
      }
    }

    const urls = [];
    const seen = new Set();

    items.forEach((item) => {
      const link = resolveLinkFromItem(item);
      if (link.url && !seen.has(link.url)) {
        seen.add(link.url);
        urls.push(link.url);
      }
    });

    return urls;
  }

  function gatherImages() {
    const images = [];
    const seen = new Set();

    function addCandidate(el, src, kind) {
      if (!src || src.startsWith('data:') || seen.has(src)) return;
      seen.add(src);
      images.push({
        id: `${kind}-${images.length}`,
        src,
        element: el,
        locator: buildLocator(el),
        kind,
      });
    }

    document.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src;
      addCandidate(img, src, 'img');
    });

    document.querySelectorAll('picture source').forEach((source) => {
      const srcset = source.getAttribute('srcset');
      if (!srcset) return;
      const src = srcset.split(',')[0]?.trim().split(' ')[0];
      addCandidate(source.parentElement || source, src, 'picture');
    });

    document.querySelectorAll('*').forEach((el) => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') return;
      const match = bg.match(/url\(["']?(.*?)["']?\)/);
      if (match && match[1]) addCandidate(el, match[1], 'background');
    });

    return images.filter((item) => item.src);
  }

  function waitForReady(requiredLocators = [], timeoutMs = 15000) {
    return new Promise((resolve) => {
      let settled = false;
      let quietTimer = null;
      const start = Date.now();

      const finish = () => {
        if (settled) return;
        settled = true;
        if (mutationObserver) mutationObserver.disconnect();
        resolve();
      };

      const check = () => {
        if (Date.now() - start > timeoutMs) {
          finish();
          return;
        }

        const resolved = requiredLocators.filter((locator) => findLocator(locator)).length;
        const enoughResolved = requiredLocators.length === 0 || resolved >= Math.ceil(requiredLocators.length * 0.6);

        if (document.readyState === 'complete' && enoughResolved) {
          if (window.requestIdleCallback) {
            window.requestIdleCallback(() => finish(), { timeout: 500 });
          } else {
            setTimeout(finish, 300);
          }
        }
      };

      mutationObserver = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(check, 500);
      });

      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      quietTimer = setTimeout(check, 700);
      setTimeout(finish, timeoutMs);
    });
  }

  async function saveConfig(partial) {
    state.config = {
      ...(state.config || {}),
      ...partial,
      host: state.host,
      updatedAt: new Date().toISOString(),
    };

    const result = await apiPost('/config', {
      host: state.host,
      config: state.config,
    });

    state.config = result.config;
    state.hasConfig = true;
    renderPanel();
  }

  async function loadSchemaAndConfig() {
    try {
      state.schema = await apiGet('/schema');
    } catch (err) {
      console.warn('[Luminascent] Failed to load schema', err);
    }

    try {
      state.config = await apiGet(`/config?host=${encodeURIComponent(state.host)}`);
      state.hasConfig = true;
    } catch (err) {
      if (err.status !== 404) console.warn('[Luminascent] Failed to load config', err);
      state.config = null;
      state.hasConfig = false;
    }
  }

  function ensureUi() {
    if (shadowRoot) return;

    const host = document.createElement('div');
    host.id = 'lumiscrape-root';
    host.style.all = 'initial';
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .panel {
        position: fixed;
        top: 16px;
        right: 16px;
        width: 340px;
        max-height: calc(100vh - 32px);
        overflow: auto;
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
        padding: 12px 14px;
        border-bottom: 1px solid #374151;
      }
      .title { font-weight: 700; font-size: 14px; }
      .subtle { color: #9ca3af; font-size: 12px; }
      .body { padding: 12px 14px; display: grid; gap: 10px; }
      .btn {
        appearance: none;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        text-align: left;
      }
      .btn:hover { background: #374151; }
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
      }
      .item:hover { border-color: #60a5fa; }
      .tag {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 999px;
        background: #374151;
        font-size: 11px;
        margin-right: 4px;
      }
      .context-menu {
        position: fixed;
        min-width: 220px;
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
      .status { padding: 8px; background: #0f172a; border-radius: 8px; }
    `;
    shadowRoot.appendChild(style);

    panelEl = document.createElement('div');
    panelEl.className = 'panel';
    shadowRoot.appendChild(panelEl);

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
      row.className = 'context-item';
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
  }

  function setMode(mode) {
    state.mode = mode;
    clearHighlights();
    hideContextMenu();

    if (mode !== 'browse') state.hoveredCandidate = null;
    if (mode === 'images') {
      state.imageCandidates = gatherImages();
      state.imageSelections = [...(state.config?.images || [])];
    }

    renderPanel();
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
        <div class="status">
          ${state.hasConfig ? 'Configured' : 'Not configured'} ·
          Browse ${browseDone ? '✓' : '—'} ·
          Fields ${fieldsCount} ·
          Images ${imagesCount}
        </div>
        ${renderModeBody()}
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
          <button class="btn primary" id="lumiscrape-configure">Configure for scraping</button>
          <div class="subtle">Creates a host folder on the local scraper server.</div>
        `;
      }

      return `
        <div class="row">
          <button class="btn" data-mode="browse">Browse mode</button>
          <button class="btn" data-mode="product">Product mode</button>
          <button class="btn" data-mode="images">Images mode</button>
          <button class="btn" data-mode="extract">Extract mode</button>
        </div>
        <div class="subtle">Workflow: browse → product → images → extract</div>
      `;
    }

    if (state.mode === 'browse') {
      const items = state.browseCandidates
        .map(
          (group, index) => `
            <div class="item" data-group-index="${index}">
              <div><span class="tag">${group.count} items</span><span class="tag">score ${group.score}</span></div>
              <div>${group.sampleText || '(no sample text)'}</div>
            </div>
          `,
        )
        .join('');

      return `
        <div class="subtle">Hover a group to highlight it on the page. Click to lock as product list.</div>
        <button class="btn" id="lumiscrape-detect-groups">Detect groups</button>
        <div class="list">${items || '<div class="subtle">No groups detected yet.</div>'}</div>
        <button class="btn primary" id="lumiscrape-lock-browse" ${state.hoveredCandidate ? '' : 'disabled'}>
          Lock selected group
        </button>
        <button class="btn" data-mode="start">Back</button>
      `;
    }

    if (state.mode === 'product') {
      const tagged = (state.config?.product?.fields || [])
        .map(
          (field) => `
            <div class="item">
              <span class="tag">${field.fieldKey}</span>
              ${field.containment ? `<span class="tag">${field.containment.mode}</span>` : ''}
              <div class="subtle">${field.locator?.textSample || field.locator?.anchor || field.locator?.tag || ''}</div>
            </div>
          `,
        )
        .join('');

      return `
        <div class="subtle">Click elements on the page to tag schema fields.</div>
        <div class="list">${tagged || '<div class="subtle">No fields tagged yet.</div>'}</div>
        <button class="btn primary" id="lumiscrape-save-product">Save product blueprint</button>
        <button class="btn" data-mode="start">Back</button>
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
        <div class="image-grid">${cards || '<div class="subtle">No images found.</div>'}</div>
        <button class="btn primary" id="lumiscrape-save-images">Save image selections</button>
        <button class="btn" data-mode="start">Back</button>
      `;
    }

    if (state.mode === 'extract') {
      const urls = collectProductUrls();
      return `
        <div class="subtle">${urls.length} product URLs detected from browse blueprint.</div>
        <button class="btn primary" id="lumiscrape-run-extract" ${urls.length ? '' : 'disabled'}>
          Start extraction
        </button>
        <button class="btn" id="lumiscrape-stop-extract">Stop extraction</button>
        <div class="status" id="lumiscrape-extract-status">${state.extractRunning ? 'Running…' : 'Idle'}</div>
        <button class="btn" data-mode="start">Back</button>
      `;
    }

    return '';
  }

  function bindPanelEvents() {
    panelEl.querySelector('#lumiscrape-configure')?.addEventListener('click', async () => {
      await saveConfig({
        host: state.host,
        version: 1,
        createdAt: new Date().toISOString(),
        browse: null,
        product: { fields: [] },
        images: [],
      });
      setMode('start');
    });

    panelEl.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.getAttribute('data-mode')));
    });

    panelEl.querySelector('#lumiscrape-detect-groups')?.addEventListener('click', () => {
      state.browseCandidates = detectRepeatedGroups();
      renderPanel();
    });

    panelEl.querySelectorAll('[data-group-index]').forEach((itemEl) => {
      const index = Number(itemEl.getAttribute('data-group-index'));
      itemEl.addEventListener('mouseenter', () => {
        state.hoveredCandidate = state.browseCandidates[index];
        highlightElements(state.hoveredCandidate?.members || [], true);
      });
      itemEl.addEventListener('mouseleave', () => {
        if (state.mode === 'browse') clearHighlights();
      });
      itemEl.addEventListener('click', () => {
        state.hoveredCandidate = state.browseCandidates[index];
        highlightElements(state.hoveredCandidate?.members || [], true);
        renderPanel();
      });
    });

    panelEl.querySelector('#lumiscrape-lock-browse')?.addEventListener('click', async () => {
      const group = state.hoveredCandidate;
      if (!group) return;

      const linkSamples = group.members.slice(0, 5).map(resolveLinkFromItem);
      const hrefCount = linkSamples.filter((sample) => sample.type === 'href' || sample.type === 'data-href').length;
      const jsCount = linkSamples.filter((sample) => sample.type === 'js-click').length;

      await saveConfig({
        browse: {
          containerLocator: group.containerLocator,
          itemLocator: group.itemLocator,
          membersSample: group.members.slice(0, 5).map((member) => buildLocator(member)),
          fingerprint: group.fingerprint,
          count: group.count,
          linkStrategy: hrefCount >= jsCount ? 'href' : 'js-click',
          lockedAt: new Date().toISOString(),
        },
      });

      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-save-product')?.addEventListener('click', async () => {
      await saveConfig({ product: state.config.product });
      setMode('start');
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

    panelEl.querySelector('#lumiscrape-run-extract')?.addEventListener('click', () => {
      startExtraction();
    });

    panelEl.querySelector('#lumiscrape-stop-extract')?.addEventListener('click', () => {
      stopExtraction();
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

    const el = getElementFromEvent(event);
    if (!el) return;

    event.preventDefault();
    event.stopPropagation();

    state.selectedElement = el;
    highlightElements([el], true);

    const schemaFields = state.schema?.fields || [];
    const menuItems = schemaFields
      .filter((field) => field.scope !== 'image')
      .map((field) => ({
        label: `${field.label} (${field.key})`,
        onClick: () => tagField(field, el),
      }));

    if (state.pendingContainmentParent) {
      menuItems.unshift({
        label: `Also contains → ${state.pendingContainmentParent.fieldKey}`,
        onClick: () => tagContainment('also_contains', el),
      });
      menuItems.unshift({
        label: `Sometimes contains → ${state.pendingContainmentParent.fieldKey}`,
        onClick: () => tagContainment('sometimes_contains', el),
      });
    }

    const taggedFields = state.config?.product?.fields || [];
    taggedFields.forEach((field) => {
      menuItems.push({
        label: `Add sub-tag under ${field.fieldKey}`,
        onClick: () => {
          state.pendingContainmentParent = field;
          renderPanel();
        },
      });
    });

    showContextMenu(event.clientX, event.clientY, menuItems);
  }

  function tagField(field, el) {
    const locator = buildLocator(el);
    const entry = {
      fieldKey: field.key,
      scope: field.scope,
      cardinality: field.cardinality,
      type: field.type,
      locator,
      extraction: locator.extraction,
      taggedAt: new Date().toISOString(),
    };

    const fields = [...(state.config?.product?.fields || [])];
    const existingIndex = fields.findIndex((item) => item.fieldKey === field.key && !item.containment);
    if (existingIndex >= 0) fields[existingIndex] = entry;
    else fields.push(entry);

    state.config.product = { ...(state.config.product || {}), fields };
    state.pendingContainmentParent = null;
    renderPanel();
  }

  function tagContainment(mode, el) {
    const parent = state.pendingContainmentParent;
    if (!parent) return;

    const parentIndex = (state.config?.product?.fields || []).findIndex((field) => field === parent);
    if (parentIndex < 0) return;

    const subLocator = buildLocator(el);
    const fields = [...state.config.product.fields];
    const parentField = { ...fields[parentIndex] };

    parentField.containment = parentField.containment || { mode, subTags: [] };
    parentField.containment.mode = mode;
    parentField.containment.subTags = [
      ...(parentField.containment.subTags || []),
      {
        locator: subLocator,
        extraction: subLocator.extraction,
        textSample: subLocator.textSample,
      },
    ];

    fields[parentIndex] = parentField;
    state.config.product = { ...state.config.product, fields };
    state.pendingContainmentParent = null;
    renderPanel();
  }

  function onHoverSelectable(event) {
    if (state.mode !== 'product') return;
    const el = getElementFromEvent(event);
    document.querySelectorAll('.lumiscrape-selectable-hover').forEach((node) => {
      node.classList.remove('lumiscrape-selectable-hover');
    });
    if (el) el.classList.add('lumiscrape-selectable-hover');
  }

  function getExtractState() {
    return GM_getValue(EXTRACT_KEY, {
      active: false,
      queue: [],
      inFlight: [],
      completed: [],
      failed: [],
    });
  }

  function setExtractState(next) {
    GM_setValue(EXTRACT_KEY, next);
  }

  function stopExtraction() {
    state.extractRunning = false;
    setExtractState({
      active: false,
      queue: [],
      inFlight: [],
      completed: [],
      failed: [],
    });
    renderPanel();
  }

  function withScrapeFlag(urlString) {
    const parsed = new URL(urlString, location.href);
    parsed.hash = parsed.hash ? `${parsed.hash.replace(/^#/, '')}&lumiscrape=1` : 'lumiscrape=1';
    if (!parsed.hash.startsWith('#')) parsed.hash = `#${parsed.hash}`;
    return parsed.href;
  }

  function stripScrapeFlag(urlString) {
    try {
      const parsed = new URL(urlString);
      parsed.hash = parsed.hash
        .replace(/^#/, '')
        .split('&')
        .filter((part) => part !== 'lumiscrape=1')
        .join('&');
      return parsed.href.replace(/#$/, '');
    } catch {
      return String(urlString).replace(/[#&]lumiscrape=1/g, '');
    }
  }

  function launchNextTabs() {
    const extractState = getExtractState();
    if (!extractState.active) return;

    while (
      extractState.inFlight.length < MAX_CONCURRENT_TABS &&
      extractState.queue.length > 0
    ) {
      const url = extractState.queue.shift();
      extractState.inFlight.push(url);
      GM_openInTab(withScrapeFlag(url), {
        active: false,
        insert: true,
      });
    }

    setExtractState(extractState);
    updateExtractStatus();
  }

  function updateExtractStatus() {
    const statusEl = panelEl?.querySelector('#lumiscrape-extract-status');
    if (!statusEl) return;
    const extractState = getExtractState();
    statusEl.textContent = extractState.active
      ? `Running · queued ${extractState.queue.length} · in flight ${extractState.inFlight.length} · done ${extractState.completed.length} · failed ${extractState.failed.length}`
      : 'Idle';
  }

  function startExtraction() {
    const urls = collectProductUrls();
    if (!urls.length) return;

    state.extractRunning = true;
    setExtractState({
      active: true,
      queue: urls,
      inFlight: [],
      completed: [],
      failed: [],
      host: state.host,
      startedAt: new Date().toISOString(),
    });

    launchNextTabs();
    renderPanel();
  }

  function markExtractResult(url, ok, errorMessage) {
    const extractState = getExtractState();
    extractState.inFlight = extractState.inFlight.filter((item) => item !== url);

    if (ok) extractState.completed.push(url);
    else extractState.failed.push({ url, error: errorMessage || 'unknown error' });

    if (extractState.queue.length === 0 && extractState.inFlight.length === 0) {
      extractState.active = false;
      state.extractRunning = false;
    }

    setExtractState(extractState);
    launchNextTabs();
    updateExtractStatus();
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function fetchImageBlob(imageUrl) {
    const response = await gmRequest({
      url: imageUrl,
      responseType: 'blob',
    });
    return response.response;
  }

  function extensionFromUrl(imageUrl) {
    try {
      const pathname = new URL(imageUrl).pathname;
      const ext = pathname.split('.').pop();
      if (ext && ext.length <= 5) return ext.toLowerCase();
    } catch {
      /* ignore */
    }
    return 'jpg';
  }

  function buildScrapedData() {
    const fields = state.config?.product?.fields || [];
    const data = {
      source_url: stripScrapeFlag(location.href),
      scrapedAt: new Date().toISOString(),
    };

    const sizeBucket = {};

    fields.forEach((field) => {
      const el = findLocator(field.locator);
      const value = extractValue(el, field.extraction);
      if (value == null || value === '') return;

      if (field.scope === 'size') {
        const key = field.fieldKey === 'size_source_url' ? 'source_url' : field.fieldKey;
        sizeBucket[key] = value;
        return;
      }

      if (field.scope === 'note') {
        data.notes = data.notes || [];
        data.notes.push({
          name: field.fieldKey === 'note_name' ? value : undefined,
          note_slug: field.fieldKey === 'note_slug' ? value : undefined,
          pyramid_stage: field.fieldKey === 'note_pyramid_stage' ? value : undefined,
        });
        return;
      }

      if (field.scope === 'accord') {
        data.accords = data.accords || [];
        data.accords.push({
          name: field.fieldKey === 'accord_name' ? value : undefined,
          accord_slug: field.fieldKey === 'accord_slug' ? value : undefined,
        });
        return;
      }

      data[field.fieldKey] = value;

      if (field.containment?.subTags?.length && el) {
        field.containment.subTags.forEach((subTag, index) => {
          const relative = findLocator(subTag.locator, el) || findLocator(subTag.locator);
          const subValue = extractValue(relative, subTag.extraction);
          if (!subValue) return;

          data[`${field.fieldKey}_embedded_${index + 1}`] = {
            mode: field.containment.mode,
            value: subValue,
          };
        });
      }
    });

    if (Object.keys(sizeBucket).length) {
      data.sizes = [sizeBucket];
    }

    const images = [];
    (state.config?.images || []).forEach((imageSel) => {
      const el = findLocator(imageSel.locator);
      const src = extractValue(el, { type: 'attribute', attribute: 'src' }) || imageSel.src;
      if (!src) return;
      images.push({
        source_url: src,
        position: imageSel.order - 1,
        is_primary: imageSel.order === 1,
      });
    });

    if (images.length) data.images = images;

    return data;
  }

  async function runAutoScrapeTab() {
    const cleanUrl = stripScrapeFlag(location.href);
    const requiredLocators = [
      ...(state.config?.product?.fields || []).map((field) => field.locator),
      ...(state.config?.images || []).map((image) => image.locator),
    ].filter(Boolean);

    await waitForReady(requiredLocators);

    const data = buildScrapedData();
    data.source_url = cleanUrl;
    const slugResult = await apiGet(`/slug?url=${encodeURIComponent(cleanUrl)}`);
    const urlSlug = slugResult.urlSlug;

    await apiPost('/product', {
      host: state.host,
      url: cleanUrl,
      urlSlug,
      data,
    });

    for (const imageSel of state.config?.images || []) {
      const el = findLocator(imageSel.locator);
      const src = extractValue(el, { type: 'attribute', attribute: 'src' }) || imageSel.src;
      if (!src) continue;

      try {
        const blob = await fetchImageBlob(src);
        const dataBase64 = await blobToBase64(blob);
        await apiPost('/image', {
          host: state.host,
          urlSlug,
          order: imageSel.order,
          ext: extensionFromUrl(src),
          dataBase64,
        });
      } catch (err) {
        console.warn('[Luminascent] Failed to save image', src, err);
      }
    }

    markExtractResult(cleanUrl, true);
    window.close();
  }

  async function init() {
    ensureUi();

    if (location.hash.includes('lumiscrape=1')) {
      await loadSchemaAndConfig();
      if (!state.config) {
        console.warn('[Luminascent] No config for auto scrape tab');
        markExtractResult(location.href, false, 'missing config');
        return;
      }

      try {
        await runAutoScrapeTab();
      } catch (err) {
        console.error('[Luminascent] Auto scrape failed', err);
        markExtractResult(location.href, false, err.message);
      }
      return;
    }

    await loadSchemaAndConfig();
    renderPanel();

    document.addEventListener('click', onProductClick, true);
    document.addEventListener('mousemove', onHoverSelectable, true);
    document.addEventListener('click', hideContextMenu, true);

    setInterval(() => {
      if (state.mode === 'extract') updateExtractStatus();
    }, 1000);
  }

  init().catch((err) => {
    console.error('[Luminascent] init failed', err);
  });
})();
