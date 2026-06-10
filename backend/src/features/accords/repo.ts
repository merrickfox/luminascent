import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
import type { Accord } from './types';

export async function createAccord(
	db: Db,
	input: { name: string; slug?: string },
): Promise<Accord> {
	const id = newId();
	const slug = input.slug ?? slugify(input.name);

	await execute(db, `INSERT INTO accords (id, name, slug) VALUES (?, ?, ?)`, id, input.name, slug);

	const accord = await queryOne<Accord>(db, `SELECT * FROM accords WHERE id = ?`, id);
	if (!accord) throw new Error('Failed to create accord');
	return accord;
}

export async function getAccordBySlug(db: Db, slug: string): Promise<Accord | null> {
	return queryOne<Accord>(db, `SELECT * FROM accords WHERE slug = ?`, slug);
}

export async function listAccords(db: Db): Promise<Accord[]> {
	return queryAll<Accord>(db, `SELECT * FROM accords ORDER BY name`);
}
