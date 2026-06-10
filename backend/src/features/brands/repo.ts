import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
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
