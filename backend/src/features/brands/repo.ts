import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
import { rebuildProductSearch } from '../products/fts';
import type { Brand } from './types';

export async function createBrand(
	db: Db,
	input: { name: string; slug?: string; country?: string; website_url?: string },
): Promise<Brand> {
	const id = newId();
	const slug = input.slug ?? slugify(input.name);

	await execute(
		db,
		`INSERT INTO brands (id, name, slug, country, website_url) VALUES (?, ?, ?, ?, ?)`,
		id,
		input.name,
		slug,
		input.country ?? null,
		input.website_url ?? null,
	);

	const brand = await queryOne<Brand>(db, `SELECT * FROM brands WHERE id = ?`, id);
	if (!brand) throw new Error('Failed to create brand');
	return brand;
}

export async function getBrandBySlug(db: Db, slug: string): Promise<Brand | null> {
	return queryOne<Brand>(db, `SELECT * FROM brands WHERE slug = ?`, slug);
}

export async function listBrands(db: Db): Promise<Brand[]> {
	return queryAll<Brand>(db, `SELECT * FROM brands ORDER BY name`);
}

export async function updateBrand(
	db: Db,
	id: string,
	input: { name?: string; slug?: string; country?: string; website_url?: string },
): Promise<Brand | null> {
	const existing = await queryOne<Brand>(db, `SELECT * FROM brands WHERE id = ?`, id);
	if (!existing) return null;

	const fields: string[] = [];
	const values: unknown[] = [];
	if (input.name !== undefined) {
		fields.push('name = ?');
		values.push(input.name);
	}
	if (input.slug !== undefined) {
		fields.push('slug = ?');
		values.push(input.slug);
	}
	if (input.country !== undefined) {
		fields.push('country = ?');
		values.push(input.country || null);
	}
	if (input.website_url !== undefined) {
		fields.push('website_url = ?');
		values.push(input.website_url || null);
	}

	if (fields.length > 0) {
		fields.push('updated_at = CURRENT_TIMESTAMP');
		await execute(db, `UPDATE brands SET ${fields.join(', ')} WHERE id = ?`, ...values, id);
	}

	// Brand name is denormalized into the product_search FTS index, so when it
	// changes we must rebuild the search rows for every product of this brand.
	if (input.name !== undefined && input.name !== existing.name) {
		const products = await queryAll<{ id: string }>(
			db,
			`SELECT id FROM products WHERE brand_id = ?`,
			id,
		);
		for (const product of products) {
			await rebuildProductSearch(db, product.id);
		}
	}

	return queryOne<Brand>(db, `SELECT * FROM brands WHERE id = ?`, id);
}

export async function deleteBrand(db: Db, id: string): Promise<boolean> {
	const existing = await queryOne<Brand>(db, `SELECT id FROM brands WHERE id = ?`, id);
	if (!existing) return false;

	// Products reference brands via a foreign key with no ON DELETE clause, so
	// this throws "FOREIGN KEY constraint failed" if any product still uses it.
	await execute(db, `DELETE FROM brands WHERE id = ?`, id);
	return true;
}
