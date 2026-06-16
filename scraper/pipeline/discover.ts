import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getScraperRoot } from './config.js';

export interface ProductRef {
  hostSlug: string;
  productSlug: string;
  productDir: string;
  llmInputPath: string;
  llmOutputPath: string;
}

export function listHostSlugs(): string[] {
  const sitesDir = join(getScraperRoot(), 'sites');
  if (!existsSync(sitesDir)) return [];

  return readdirSync(sitesDir)
    .filter((entry) => {
      const path = join(sitesDir, entry);
      return statSync(path).isDirectory() && existsSync(join(path, 'config.json'));
    })
    .sort();
}

export function listProducts(hostSlug: string): ProductRef[] {
  const productsDir = join(getScraperRoot(), 'sites', hostSlug, 'products');
  if (!existsSync(productsDir)) return [];

  return readdirSync(productsDir)
    .filter((entry) => {
      const path = join(productsDir, entry);
      return statSync(path).isDirectory() && existsSync(join(path, 'llm_input.json'));
    })
    .sort()
    .map((productSlug) => {
      const productDir = join(productsDir, productSlug);
      return {
        hostSlug,
        productSlug,
        productDir,
        llmInputPath: join(productDir, 'llm_input.json'),
        llmOutputPath: join(productDir, 'llm_output.json'),
      };
    });
}

export function resolveProducts(options: {
  allBrands?: boolean;
  brand?: string;
  product?: string;
}): ProductRef[] {
  if (options.product && !options.brand) {
    throw new Error('--product requires --brand <host_slug>');
  }

  const hostSlugs = options.brand
    ? [options.brand]
    : options.allBrands
      ? listHostSlugs()
      : listHostSlugs();

  if (hostSlugs.length === 0) {
    return [];
  }

  const products: ProductRef[] = [];
  for (const hostSlug of hostSlugs) {
    const siteProducts = listProducts(hostSlug);
    if (options.product) {
      const match = siteProducts.filter((p) => p.productSlug === options.product);
      if (match.length === 0) {
        throw new Error(`Product not found: ${hostSlug}/${options.product}`);
      }
      products.push(...match);
    } else {
      products.push(...siteProducts);
    }
  }

  return products;
}
