import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index';
import { listProducts } from '../src/features/products/repo';
import { searchProducts, rebuildProductSearch } from '../src/features/products/fts';
import { applyMigrations } from './applyMigrations';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('luminascent backend', () => {
	beforeAll(async () => {
		await applyMigrations(env.DB);
		await rebuildProductSearch(env.DB, 'prod-feudebois');
		await rebuildProductSearch(env.DB, 'prod-bakery');
	});

	it('health check', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.json<{ name: string; status: string }>();
		expect(body).toEqual({ name: 'luminascent-backend', status: 'ok' });
	});

	it('faceted search: candles rated 4+ with flour note', async () => {
		const products = await listProducts(env.DB, {
			category: 'candle',
			min_rating: 4,
			notes: ['flour'],
		});
		expect(products).toHaveLength(0);
	});

	it('faceted search: bakery candle rated 3.86+ with flour note', async () => {
		const products = await listProducts(env.DB, {
			category: 'candle',
			min_rating: 3.8,
			notes: ['flour'],
		});
		expect(products).toHaveLength(1);
		expect(products[0]?.slug).toBe('bakery-scent');
	});

	it('faceted search: woody winter strong sillage candles', async () => {
		const products = await listProducts(env.DB, {
			category: 'candle',
			accords: ['woody'],
			vote_options: ['winter', 'strong'],
		});
		expect(products).toHaveLength(1);
		expect(products[0]?.slug).toBe('feu-de-bois');
	});

	it('fts search finds products by note text', async () => {
		const ids = await searchProducts(env.DB, 'flour', 10);
		expect(ids).toContain('prod-bakery');
	});

	it('GET /products/:slug returns nested product', async () => {
		const response = await SELF.fetch('https://example.com/products/feu-de-bois');
		expect(response.status).toBe(200);
		const body = await response.json<{ product: { slug: string }; accords: unknown[]; sizes: unknown[] }>();
		expect(body.product.slug).toBe('feu-de-bois');
		expect(body.accords.length).toBeGreaterThan(0);
		expect(body.sizes.length).toBeGreaterThan(0);
		expect(body.sizes[0]).toMatchObject({ size_grams: 190, is_primary: 1 });
	});
});
