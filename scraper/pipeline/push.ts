import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PipelineConfig, ScrapedImageRecord, ScrapedProductRecord, SitePipelineConfig } from './types.js';
import { getScraperRoot, resolveSiteBrand } from './config.js';
import { formatApiError } from './format-error.js';
import { normalizeImageSourceUrl } from './image-url.js';
import { sniffImage } from './image-bytes.js';

function resolveImageFile(hostSlug: string, file: string): string {
  if (file.startsWith('/')) return file;
  return join(getScraperRoot(), 'sites', hostSlug, file);
}

function hydrateImages(hostSlug: string, images: ScrapedImageRecord[] | undefined): ScrapedImageRecord[] {
  if (!images?.length) return [];

  return images
    .map((image): ScrapedImageRecord | null => {
      const source_url = normalizeImageSourceUrl(image.source_url);
      if (!image.file) return { ...image, source_url };

      const absolutePath = resolveImageFile(hostSlug, image.file);
      if (!existsSync(absolutePath)) {
        throw new Error(`Image file not found: ${absolutePath}`);
      }

      const buffer = readFileSync(absolutePath);
      // A local file is occasionally not really an image — a CDN 404 HTML page captured
      // before the fetch/save guards landed. Trust the bytes, not the extension: skip
      // non-images so we never upload a broken image, and label the content-type from
      // the true format (a webp saved as .jpg would otherwise be mislabeled).
      const sniffed = sniffImage(buffer);
      if (!sniffed) {
        console.warn(`  skipping non-image file (run repair-images): ${image.file}`);
        return null;
      }
      return {
        position: image.position,
        is_primary: image.is_primary,
        source_url,
        data_base64: buffer.toString('base64'),
        content_type: sniffed.mime,
      };
    })
    .filter((image): image is ScrapedImageRecord => image !== null);
}

export interface PushOptions {
  hostSlug: string;
  backendUrl: string;
  apiKey: string;
  updateExisting: boolean;
  refetchImages: boolean;
  productSlug?: string;
  siteBrand?: SitePipelineConfig;
}

export interface PushResult {
  slug: string;
  name: string;
  status: string;
  error?: string;
  warnings?: string[];
}

function formatPushLine(name: string, outcome: { status: string; error?: string; warnings?: string[] }): string {
  if (outcome.status === 'failed') {
    return `${name}: failed — ${outcome.error ?? 'unknown error'}`;
  }
  const warningSuffix =
    outcome.warnings && outcome.warnings.length > 0 ? ` (warnings: ${outcome.warnings.join('; ')})` : '';
  return `${name}: ${outcome.status}${warningSuffix}`;
}

async function ensureBrand(
  backendUrl: string,
  apiKey: string,
  brandName: string,
  brandSlug: string,
): Promise<void> {
  const response = await fetch(`${backendUrl.replace(/\/$/, '')}/admin/import/brand`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ name: brandName, slug: brandSlug }),
  });

  if (!response.ok && response.status !== 200 && response.status !== 201) {
    const body = await response.text();
    throw new Error(`Brand ensure failed (${response.status}): ${body}`);
  }
}

function sanitizeForImport(product: ScrapedProductRecord): ScrapedProductRecord {
  const roundInt = (value: unknown): unknown =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : value;

  return {
    ...product,
    release_year: roundInt(product.release_year) as number | null | undefined,
    sizes: product.sizes?.map((size) => ({
      ...size,
      size_grams: roundInt(size.size_grams),
      burn_time_hours: roundInt(size.burn_time_hours),
    })),
  };
}

async function pushProduct(
  backendUrl: string,
  apiKey: string,
  product: ScrapedProductRecord,
  options: { updateExisting: boolean; refetchImages: boolean },
): Promise<{ status: string; error?: string; warnings?: string[] }> {
  const response = await fetch(`${backendUrl.replace(/\/$/, '')}/admin/import/product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      product,
      options: {
        update_existing: options.updateExisting,
        refetch_images: options.refetchImages,
      },
    }),
  });

  let body: unknown;
  const raw = await response.text();
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }

  if (!response.ok) {
    return { status: 'failed', error: formatApiError(body, response.status) };
  }

  const parsed = body as {
    result?: { status?: string; error?: string; warnings?: string[] };
  };

  const status = parsed.result?.status ?? 'unknown';
  const error = parsed.result?.error;
  const warnings = parsed.result?.warnings ?? [];

  if (status === 'failed') {
    return { status, error: error ?? 'Import failed (no error message from backend)', warnings };
  }

  return { status, error, warnings };
}

export async function pushSiteProducts(
  config: PipelineConfig,
  options: PushOptions,
): Promise<PushResult[]> {
  const productsPath = join(getScraperRoot(), 'sites', options.hostSlug, 'products.json');
  if (!existsSync(productsPath)) {
    throw new Error(`products.json not found for site: ${options.hostSlug}`);
  }

  const siteBrand = options.siteBrand ?? resolveSiteBrand(options.hostSlug);
  const products = JSON.parse(readFileSync(productsPath, 'utf-8')) as ScrapedProductRecord[];
  const filtered = (options.productSlug
    ? products.filter((p) => p.slug === options.productSlug)
    : products
  ).map((product) => ({
    ...product,
    brand_name: product.brand_name ?? siteBrand.brand_name,
    brand_slug: product.brand_slug ?? siteBrand.brand_slug,
    category_slug: product.category_slug ?? siteBrand.category_slug ?? 'candle',
  }));

  if (filtered.length === 0) {
    throw new Error('No products to push');
  }

  const brandSlug = filtered[0]?.brand_slug;
  const brandName = filtered[0]?.brand_name;
  if (!brandSlug || !brandName) {
    throw new Error(
      'Could not resolve brand_slug and brand_name. Add sites/<host>/pipeline.json or pass --brand-name and --brand-slug.',
    );
  }

  await ensureBrand(options.backendUrl, options.apiKey, brandName, brandSlug);

  const results: PushResult[] = [];

  for (const product of filtered) {
    const hydrated: ScrapedProductRecord = sanitizeForImport({
      ...product,
      images: hydrateImages(options.hostSlug, product.images),
    });

    try {
      const outcome = await pushProduct(options.backendUrl, options.apiKey, hydrated, {
        updateExisting: options.updateExisting,
        refetchImages: options.refetchImages,
      });
      results.push({
        slug: product.slug ?? product.name,
        name: product.name,
        status: outcome.status,
        error: outcome.error,
        warnings: outcome.warnings,
      });
      if (outcome.status === 'failed') {
        console.error(`  ${formatPushLine(product.name, outcome)}`);
      } else {
        console.log(`  ${formatPushLine(product.name, outcome)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        slug: product.slug ?? product.name,
        name: product.name,
        status: 'failed',
        error: message,
      });
      console.error(`  ${product.name}: failed — ${message}`);
    }
  }

  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    console.error('\n  Failures:');
    for (const result of failed) {
      console.error(`    ${result.slug}: ${result.error ?? 'unknown error'}`);
    }
  }

  return results;
}
