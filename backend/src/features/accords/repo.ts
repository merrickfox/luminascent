import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
import type { Accord } from './types';

export async function createAccord(
	db: Db,
	input: { name: string; slug?: string; color?: string; color_gradient?: string },
): Promise<Accord> {
	const id = newId();
	const slug = input.slug ?? slugify(input.name);

	await execute(
		db,
		`INSERT INTO accords (id, name, slug, color, color_gradient) VALUES (?, ?, ?, ?, ?)`,
		id,
		input.name,
		slug,
		input.color ?? null,
		input.color_gradient ?? null,
	);

	const accord = await queryOne<Accord>(db, `SELECT * FROM accords WHERE id = ?`, id);
	if (!accord) throw new Error('Failed to create accord');
	return accord;
}

export async function getAccordById(db: Db, id: string): Promise<Accord | null> {
	return queryOne<Accord>(db, `SELECT * FROM accords WHERE id = ?`, id);
}

export async function getAccordBySlug(db: Db, slug: string): Promise<Accord | null> {
	return queryOne<Accord>(db, `SELECT * FROM accords WHERE slug = ?`, slug);
}

export async function listAccords(db: Db): Promise<Accord[]> {
	return queryAll<Accord>(db, `SELECT * FROM accords ORDER BY name`);
}

export async function updateAccordColor(
	db: Db,
	id: string,
	input: { color: string; color_gradient?: string | null },
): Promise<Accord | null> {
	await execute(
		db,
		`UPDATE accords SET color = ?, color_gradient = ? WHERE id = ?`,
		input.color,
		input.color_gradient ?? null,
		id,
	);
	return getAccordById(db, id);
}

export async function fillAccordColorIfNull(
	db: Db,
	id: string,
	input: { color: string; color_gradient?: string | null },
): Promise<void> {
	await execute(
		db,
		`UPDATE accords SET color = ?, color_gradient = ? WHERE id = ? AND color IS NULL`,
		input.color,
		input.color_gradient ?? null,
		id,
	);
}
