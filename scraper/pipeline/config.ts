import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PipelineConfig, SchemaDefinition, SitePipelineConfig } from './types.js';
import { slugify } from './slug.js';

const SCRAPER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function getScraperRoot(): string {
  return SCRAPER_ROOT;
}

export function loadPipelineConfig(configPath?: string): PipelineConfig {
  const path = configPath ?? join(SCRAPER_ROOT, 'pipeline.config.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as PipelineConfig;
}

export function loadSchema(schemaName: string): SchemaDefinition {
  const path = join(SCRAPER_ROOT, 'schema', `${schemaName}.schema.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as SchemaDefinition;
}

export function loadSitePipelineConfig(hostSlug: string): SitePipelineConfig | null {
  const path = join(SCRAPER_ROOT, 'sites', hostSlug, 'pipeline.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as SitePipelineConfig;
}

export function loadHostConfig(
  hostSlug: string,
): { host: string; hostSlug: string; brand: { name: string; slug?: string } | null } | null {
  const path = join(SCRAPER_ROOT, 'sites', hostSlug, 'config.json');
  if (!existsSync(path)) return null;
  const config = JSON.parse(readFileSync(path, 'utf-8')) as {
    host?: string;
    hostSlug?: string;
    brand?: { name?: string; slug?: string } | null;
  };
  const brand = config.brand?.name ? { name: config.brand.name, slug: config.brand.slug } : null;
  return {
    host: config.host ?? hostSlug,
    hostSlug: config.hostSlug ?? hostSlug,
    brand,
  };
}

function deriveBrandFromHost(host: string): Pick<SitePipelineConfig, 'brand_name' | 'brand_slug'> {
  const domain = host.replace(/^www\./, '').split('.')[0] ?? host;
  return {
    brand_name: domain
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    brand_slug: slugify(domain),
  };
}

function deriveBrandFromHostSlug(hostSlug: string): Pick<SitePipelineConfig, 'brand_name' | 'brand_slug'> {
  return {
    brand_name: hostSlug
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    brand_slug: hostSlug.replace(/_/g, '-'),
  };
}

/**
 * Site brand defaults, lowest precedence first:
 * host slug < derived from config host < explicit blueprint brand < pipeline.json < CLI overrides.
 * An explicit brand entered at scrape-configure time (stored in config.json) is authoritative
 * over host-derivation; a blank brand falls back to the historical host-derived behavior.
 */
export function resolveSiteBrand(
  hostSlug: string,
  overrides?: Partial<SitePipelineConfig>,
): SitePipelineConfig {
  const hostConfig = loadHostConfig(hostSlug);
  let derived: Pick<SitePipelineConfig, 'brand_name' | 'brand_slug'>;
  if (hostConfig?.brand) {
    derived = {
      brand_name: hostConfig.brand.name,
      brand_slug: hostConfig.brand.slug ?? slugify(hostConfig.brand.name),
    };
  } else if (hostConfig) {
    derived = deriveBrandFromHost(hostConfig.host);
  } else {
    derived = deriveBrandFromHostSlug(hostSlug);
  }

  return {
    category_slug: 'candle',
    ...derived,
    ...loadSitePipelineConfig(hostSlug),
    ...overrides,
  };
}
