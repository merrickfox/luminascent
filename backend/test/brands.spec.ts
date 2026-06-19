import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { searchProducts, rebuildProductSearch } from '../src/features/products/fts';
import type { Brand } from '../src/features/brands/types';
import { applyMigrations } from './applyMigrations';

const ADMIN_KEY = env.ADMIN_API_KEY ?? 'dev-admin-key';

function adminFetch(path: string, init?: RequestInit) {
	return SELF.fetch(`https://example.com${path}`, {
		...init,
		headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json', ...init?.headers },
	});
}

describe('brands CRUD', () => {
	beforeAll(async () => {
		await applyMigrations(env.DB);
		await rebuildProductSearch(env.DB, 'prod-feudebois');
		await rebuildProductSearch(env.DB, 'prod-bakery');
	});

	it('GET /brands/:slug returns a brand', async () => {
		const res = await SELF.fetch('https://example.com/brands/diptyque');
		expect(res.status).toBe(200);
		const body = await res.json<{ brand: Brand }>();
		expect(body.brand.name).toBe('Diptyque');
	});

	it('GET /brands/:slug 404s for unknown slug', async () => {
		const res = await SELF.fetch('https://example.com/brands/does-not-exist');
		expect(res.status).toBe(404);
	});

	it('creates, updates, and reads back a brand', async () => {
		const created = await adminFetch('/admin/brands', {
			method: 'POST',
			body: JSON.stringify({ name: 'Test Co', country: 'UK' }),
		});
		expect(created.status).toBe(201);
		const { brand } = await created.json<{ brand: Brand }>();
		expect(brand.slug).toBe('test-co');

		const updated = await adminFetch(`/admin/brands/${brand.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ name: 'Test Co Renamed', website_url: 'https://example.org' }),
		});
		expect(updated.status).toBe(200);
		const after = await updated.json<{ brand: Brand }>();
		expect(after.brand.name).toBe('Test Co Renamed');
		expect(after.brand.website_url).toBe('https://example.org');
		expect(after.brand.country).toBe('UK');
	});

	it('renaming a brand rebuilds the product search index', async () => {
		// Brand name is denormalized into the FTS table — renaming must keep search current.
		const before = await searchProducts(env.DB, 'Diptyque', 10);
		expect(before).toContain('prod-feudebois');

		const res = await adminFetch('/admin/brands/brand-diptyque', {
			method: 'PATCH',
			body: JSON.stringify({ name: 'Diptyque Paris' }),
		});
		expect(res.status).toBe(200);

		const byNewName = await searchProducts(env.DB, 'Paris', 10);
		expect(byNewName).toContain('prod-feudebois');
	});

	it('blocks deleting a brand that still has products', async () => {
		const res = await adminFetch('/admin/brands/brand-yankee', { method: 'DELETE' });
		expect(res.status).toBe(409);
	});

	it('deletes a brand with no products', async () => {
		const created = await adminFetch('/admin/brands', {
			method: 'POST',
			body: JSON.stringify({ name: 'Disposable Brand' }),
		});
		const { brand } = await created.json<{ brand: Brand }>();

		const del = await adminFetch(`/admin/brands/${brand.id}`, { method: 'DELETE' });
		expect(del.status).toBe(200);

		const gone = await SELF.fetch(`https://example.com/brands/${brand.slug}`);
		expect(gone.status).toBe(404);
	});

	it('DELETE on unknown brand 404s', async () => {
		const res = await adminFetch('/admin/brands/nope', { method: 'DELETE' });
		expect(res.status).toBe(404);
	});
});
