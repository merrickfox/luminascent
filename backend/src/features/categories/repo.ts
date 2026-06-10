import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
import type { Category } from './types';

export async function createCategory(
	db: Db,
	input: { name: string; slug?: string },
): Promise<Category> {
	const id = newId();
	const slug = input.slug ?? slugify(input.name);

	await execute(db, `INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)`, id, input.name, slug);

	const category = await queryOne<Category>(db, `SELECT * FROM categories WHERE id = ?`, id);
	if (!category) throw new Error('Failed to create category');
	return category;
}

export async function getCategoryBySlug(db: Db, slug: string): Promise<Category | null> {
	return queryOne<Category>(db, `SELECT * FROM categories WHERE slug = ?`, slug);
}

export async function listCategories(db: Db): Promise<Category[]> {
	return queryAll<Category>(db, `SELECT * FROM categories ORDER BY name`);
}
