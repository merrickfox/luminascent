import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  LlmInput,
  LlmOutput,
  PipelineConfig,
  SchemaDefinition,
  SchemaField,
  ScrapedImageRecord,
  ScrapedProductRecord,
  SitePipelineConfig,
} from './types.js';
import { getScraperRoot } from './config.js';
import { slugify } from './slug.js';
import { normalizeImageSourceUrl } from './image-url.js';

function toArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/\[\]/g, '.').split('.').filter(Boolean);
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function zipScopeRows(
  scopeFields: SchemaField[],
  fields: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const arrays = scopeFields.map((field) => ({
    key: field.key,
    mapsTo: field.mapsTo ?? '',
    values: toArray(fields[field.key]),
  }));

  const maxLen = Math.max(1, ...arrays.map((a) => a.values.length));
  const rows: Array<Record<string, unknown>> = [];

  for (let i = 0; i < maxLen; i++) {
    const row: Record<string, unknown> = {};
    for (const entry of arrays) {
      if (!entry.mapsTo) continue;
      const leaf = entry.mapsTo.split('[].').pop() ?? entry.mapsTo;
      const value = entry.values[i] ?? entry.values[0] ?? null;
      if (value != null && value !== '') {
        row[leaf] = value;
      }
    }
    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  return rows;
}

function zipMultipleScope(
  scope: 'note' | 'accord',
  scopeFields: SchemaField[],
  fields: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const primaryField = scopeFields.find((f) => f.key === `${scope.slice(0, -1)}_name`) ??
    scopeFields.find((f) => f.cardinality === 'multiple');

  if (!primaryField) return [];

  const names = toArray(fields[primaryField.key]);
  if (names.length === 0) return [];

  return names.map((name, index) => {
    const row: Record<string, unknown> = {};
    for (const field of scopeFields) {
      if (!field.mapsTo) continue;
      const leaf = field.mapsTo.split('[].').pop() ?? field.mapsTo;
      const values = toArray(fields[field.key]);
      const value = values[index] ?? (field.key.endsWith('_slug') ? slugify(String(name)) : null);
      if (value != null && value !== '') {
        row[leaf] = value;
      }
    }
    if (!row.name && name != null) {
      row.name = name;
    }
    if (scope === 'note' && !row.pyramid_stage) {
      row.pyramid_stage = 'unknown';
    }
    if (scope === 'note' && !row.note_slug && row.name) {
      row.note_slug = slugify(String(row.name));
    }
    if (scope === 'accord' && !row.accord_slug && row.name) {
      row.accord_slug = slugify(String(row.name));
    }
    return row;
  });
}

/**
 * Title-case a raw scraped name without an LLM: upper-case-only tokens get
 * title-cased, already-mixed-case tokens are left alone (preserves "Eve's",
 * "&", "-"). Used only as a fallback, so light-touch normalization is enough.
 */
function cleanRawName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (/[a-z]/.test(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Guarantee every product has a usable name and a slug unique within the site.
 *
 * The per-field LLM pass can collapse distinct product pages onto one slug —
 * e.g. the `name` instruction strips size suffixes, so "CURTAIN CALL - PETITE"
 * and "CURTAIN CALL" both become "Curtain Call" → "curtain-call". Two source
 * URLs sharing a slug means the second silently overwrites the first on push.
 * It can also drop the name entirely ("Unknown"). Both are recovered from the
 * raw scraped name, which still carries the distinguishing words; a numeric
 * suffix is the last resort. Site-agnostic: keyed only on slug collisions.
 */
function ensureUniqueProductSlugs(products: ScrapedProductRecord[]): void {
  // 1. Recover a real name+slug wherever the LLM returned nothing usable.
  for (const product of products) {
    const recovered = product._rawName ? cleanRawName(product._rawName) : '';
    if (recovered && (!product.name || product.name === 'Unknown')) {
      product.name = recovered;
      product.slug = slugify(recovered);
    }
  }

  // 2. Disambiguate any slug now shared by more than one product.
  const counts = new Map<string, number>();
  for (const product of products) {
    if (product.slug) counts.set(product.slug, (counts.get(product.slug) ?? 0) + 1);
  }

  const taken = new Set<string>();
  for (const product of products) {
    if (product.slug && counts.get(product.slug) === 1) taken.add(product.slug);
  }

  for (const product of products) {
    if (!product.slug || counts.get(product.slug) === 1) continue;

    const recovered = product._rawName ? cleanRawName(product._rawName) : '';
    const recoveredSlug = recovered ? slugify(recovered) : '';
    if (recoveredSlug && !taken.has(recoveredSlug)) {
      // Raw name carried the distinction the LLM dropped — surface it.
      product.name = recovered;
      product.slug = recoveredSlug;
      taken.add(recoveredSlug);
      continue;
    }

    let suffix = 2;
    let candidate = `${product.slug}-${suffix}`;
    while (taken.has(candidate)) candidate = `${product.slug}-${++suffix}`;
    product.slug = candidate;
    taken.add(candidate);
  }
}

function listLocalImages(productDir: string): string[] {
  const imagesDir = join(productDir, 'images');
  if (!existsSync(imagesDir)) return [];
  return readdirSync(imagesDir)
    .filter((name: string) => /\.(jpe?g|png|webp)$/i.test(name))
    .sort();
}

function buildImages(
  productSlug: string,
  llmInput: LlmInput | null,
  productDir: string,
): ScrapedImageRecord[] {
  const localFiles = listLocalImages(productDir);
  const inputImages = llmInput?.images ?? [];

  if (localFiles.length === 0) {
    return inputImages.map((img) => ({
      source_url: normalizeImageSourceUrl(img.source_url),
      position: img.position,
      is_primary: img.is_primary,
    }));
  }

  return localFiles.map((filename, index) => {
    const inputMatch = inputImages[index];
    return {
      source_url: normalizeImageSourceUrl(inputMatch?.source_url),
      position: inputMatch?.position ?? index,
      is_primary: inputMatch?.is_primary ?? index === 0,
      file: `products/${productSlug}/images/${filename}`,
    };
  });
}

function assembleOneProduct(options: {
  productSlug: string;
  productDir: string;
  llmOutput: LlmOutput;
  schema: SchemaDefinition;
  siteDefaults: SitePipelineConfig;
  pipelineDefaults: PipelineConfig['defaults'];
}): ScrapedProductRecord {
  const llmInputPath = join(options.productDir, 'llm_input.json');
  const llmInput = existsSync(llmInputPath)
    ? (JSON.parse(readFileSync(llmInputPath, 'utf-8')) as LlmInput)
    : null;

  const fields = { ...options.llmOutput.fields };
  const product: ScrapedProductRecord = {
    source_url: options.llmOutput.source_url,
    category_slug:
      options.siteDefaults.category_slug ??
      options.pipelineDefaults?.category_slug ??
      'candle',
    brand_name: options.siteDefaults.brand_name,
    brand_slug: options.siteDefaults.brand_slug,
    name: String(fields.name ?? 'Unknown'),
    _productSlug: options.productSlug,
  };

  if (options.siteDefaults.brand_slug && !fields.brand_slug) {
    product.brand_slug = options.siteDefaults.brand_slug;
  }
  if (options.siteDefaults.brand_name && !fields.brand_name) {
    product.brand_name = options.siteDefaults.brand_name;
  }

  const productFields = options.schema.fields.filter((f) => f.scope === 'product' && f.mapsTo);
  for (const field of productFields) {
    if (field.key === 'source_url') continue;
    if (field.key === 'category_slug' || field.key === 'brand_name' || field.key === 'brand_slug') {
      continue;
    }
    const value = fields[field.key];
    if (value != null && value !== '') {
      setPath(product as unknown as Record<string, unknown>, field.mapsTo!, value);
    }
  }

  if (!product.slug && product.name) {
    product.slug = slugify(product.name);
  }

  const rawNameField = llmInput?.fields?.find((f) => f.fieldKey === 'name');
  if (rawNameField?.value != null) {
    const raw = Array.isArray(rawNameField.value)
      ? rawNameField.value.join(' ')
      : String(rawNameField.value);
    if (raw.trim()) product._rawName = raw.trim();
  }

  const sizeFields = options.schema.fields.filter((f) => f.scope === 'size' && f.mapsTo);
  const sizes = zipScopeRows(sizeFields, fields);
  if (sizes.length > 0) {
    product.sizes = sizes.map((size, index) => ({
      ...size,
      is_primary: index === 0,
      source_url: size.source_url ?? product.source_url,
    }));
  }

  const noteFields = options.schema.fields.filter((f) => f.scope === 'note' && f.mapsTo);
  const notes = zipMultipleScope('note', noteFields, fields);
  if (notes.length > 0) {
    product.notes = notes;
  }

  const accordFields = options.schema.fields.filter((f) => f.scope === 'accord' && f.mapsTo);
  const accords = zipMultipleScope('accord', accordFields, fields);
  if (accords.length > 0) {
    product.accords = accords;
  }

  product.images = buildImages(options.productSlug, llmInput, options.productDir);
  return product;
}

export function assembleSiteProducts(options: {
  hostSlug: string;
  schema: SchemaDefinition;
  siteDefaults: SitePipelineConfig;
  pipelineDefaults: PipelineConfig['defaults'];
  productSlugs?: string[];
}): ScrapedProductRecord[] {
  const productsDir = join(getScraperRoot(), 'sites', options.hostSlug, 'products');
  if (!existsSync(productsDir)) return [];

  const slugs =
    options.productSlugs ??
    readdirSync(productsDir).filter((entry: string) =>
      existsSync(join(productsDir, entry, 'llm_output.json')),
    );

  const products: ScrapedProductRecord[] = [];

  for (const productSlug of slugs.sort()) {
    const productDir = join(productsDir, productSlug);
    const outputPath = join(productDir, 'llm_output.json');
    if (!existsSync(outputPath)) continue;

    const llmOutput = JSON.parse(readFileSync(outputPath, 'utf-8')) as LlmOutput;
    products.push(
      assembleOneProduct({
        productSlug,
        productDir,
        llmOutput,
        schema: options.schema,
        siteDefaults: options.siteDefaults,
        pipelineDefaults: options.pipelineDefaults,
      }),
    );
  }

  ensureUniqueProductSlugs(products);
  return products;
}

function productMatchKey(product: ScrapedProductRecord): string | null {
  if (product.slug) return product.slug;
  if (product.source_url) return product.source_url;
  return null;
}

export function loadSiteProductsJson(hostSlug: string): ScrapedProductRecord[] {
  const outputPath = join(getScraperRoot(), 'sites', hostSlug, 'products.json');
  if (!existsSync(outputPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(outputPath, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as ScrapedProductRecord[]) : [];
  } catch {
    return [];
  }
}

export function mergeProducts(
  existing: ScrapedProductRecord[],
  incoming: ScrapedProductRecord[],
): ScrapedProductRecord[] {
  const incomingByKey = new Map<string, ScrapedProductRecord>();
  for (const product of incoming) {
    const key = productMatchKey(product);
    if (key) incomingByKey.set(key, product);
  }

  const seen = new Set<string>();
  const merged = existing.map((product) => {
    const key = productMatchKey(product);
    if (key && incomingByKey.has(key)) {
      seen.add(key);
      return incomingByKey.get(key)!;
    }
    return product;
  });

  for (const product of incoming) {
    const key = productMatchKey(product);
    if (key && !seen.has(key)) {
      merged.push(product);
    }
  }

  return merged;
}

export function writeSiteProductsJson(hostSlug: string, products: ScrapedProductRecord[]): string {
  const outputPath = join(getScraperRoot(), 'sites', hostSlug, 'products.json');
  const cleaned = products.map(({ _productSlug, _rawName, ...rest }) => rest);
  writeFileSync(outputPath, JSON.stringify(cleaned, null, 2));
  return outputPath;
}

export function assembleAndWrite(options: {
  hostSlug: string;
  schema: SchemaDefinition;
  siteDefaults: SitePipelineConfig;
  pipelineDefaults: PipelineConfig['defaults'];
  productSlugs?: string[];
  fresh?: boolean;
}): { outputPath: string; assembled: number; total: number; mode: 'fresh' | 'upsert' } {
  const assembled = assembleSiteProducts(options);

  let finalProducts: ScrapedProductRecord[];
  let mode: 'fresh' | 'upsert';

  if (options.fresh) {
    finalProducts = assembled;
    mode = 'fresh';
  } else {
    const existing = loadSiteProductsJson(options.hostSlug);
    finalProducts = mergeProducts(existing, assembled);
    mode = 'upsert';
  }

  const outputPath = writeSiteProductsJson(options.hostSlug, finalProducts);
  return { outputPath, assembled: assembled.length, total: finalProducts.length, mode };
}
