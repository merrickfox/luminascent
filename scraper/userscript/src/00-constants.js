  const SERVER = 'http://127.0.0.1:8777';
  const SCRAPE_HASH = '#lumiscrape=1';
  const EXTRACT_KEY = 'lumiscrape_extract_state';
  const EXTRACT_PREFS_KEY = 'lumiscrape_extract_prefs';
  const EXCLUDED_HOSTS_KEY = 'lumiscrape_excluded_hosts';
  // Child tabs report their outcome to a unique per-URL key under this prefix.
  // The controller tab is the sole writer of EXTRACT_KEY; it drains these keys
  // each tick. Unique keys mean two tabs never clobber each other's result.
  const RESULT_PREFIX = 'lumiscrape_result:';
  const BATCH_TIMEOUT_MS = 90000;
  // Grace after a tab closes with no result written before we call it failed,
  // instead of waiting out the full batch timeout.
  const CLOSE_GRACE_MS = 5000;
  const LOG_MAX = 50;

  // Controller-tab-local: when each opened tab fires onclose, in ms. Used to
  // detect tabs that vanished without reporting (crash, navigation, hibernation).
  const closedAtByUrl = new Map();
  // Child-tab-local: guards against double-reporting (success + pagehide).
  let childReported = false;

  const state = {
    mode: 'start',
    host: location.hostname,
    schema: null,
    config: null,
    hasConfig: false,
    browseCandidates: [],
    selectedBrowseGroupId: null,
    highlightEls: [],
    selectedElement: null,
    pendingTagElement: null,
    pendingTagPreview: '',
    lastTaggedMessage: '',
    pendingContainmentAdd: null,
    pendingRetagFieldKey: null,
    pendingAddTagFieldKey: null,
    imageCandidates: [],
    imageSelections: [],
    extractRunning: false,
    extractMode: 'all',
    extractBatchSize: 5,
    extractGapSeconds: 0,
    // Sub-selection within a browse grid: URLs the user has unchecked for this
    // page. Empty/absent = extract everything (preserves default behavior).
    extractDeselected: null,
    extractRefineOpen: false,
    extractItems: [],
    adhocStatus: '',
    browseScanStatus: 'idle',
    autoDetecting: false,
    autoStatus: '',
  };

  let shadowRoot = null;
  let panelEl = null;
  let highlightLayer = null;
  let contextMenuEl = null;
  let mutationObserver = null;
  let browseWatchObserver = null;
  let browseDetectTimer = null;
  let browseDetectRunning = false;
  let extractController = false;

  const STABLE_ATTRS = [
    'id',
    'name',
    'role',
    'aria-label',
    'itemprop',
    'data-testid',
    'data-test',
    'data-ui-id',
    'data-dynamic',
    'data-block-id',
    'data-attribute-code',
    'data-price-type',
    'data-gallery-role',
    'data-role',
  ];

  const RECIPE_ATTRS = [
    'itemprop',
    'role',
    'name',
    'data-ui-id',
    'data-dynamic',
    'data-block-id',
    'data-testid',
    'data-test',
    'data-attribute-code',
    'data-price-type',
    'data-gallery-role',
    'data-role',
    'ku-block',
    'ku-product-block',
  ];