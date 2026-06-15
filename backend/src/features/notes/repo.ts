import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
import type { Note } from './types';

export async function createNote(
	db: Db,
	input: { name: string; slug?: string; note_family?: string; color?: string; color_gradient?: string },
): Promise<Note> {
	const id = newId();
	const slug = input.slug ?? slugify(input.name);

	await execute(
		db,
		`INSERT INTO notes (id, name, slug, note_family, color, color_gradient) VALUES (?, ?, ?, ?, ?, ?)`,
		id,
		input.name,
		slug,
		input.note_family ?? null,
		input.color ?? null,
		input.color_gradient ?? null,
	);

	const note = await queryOne<Note>(db, `SELECT * FROM notes WHERE id = ?`, id);
	if (!note) throw new Error('Failed to create note');
	return note;
}

export async function getNoteById(db: Db, id: string): Promise<Note | null> {
	return queryOne<Note>(db, `SELECT * FROM notes WHERE id = ?`, id);
}

export async function getNoteBySlug(db: Db, slug: string): Promise<Note | null> {
	return queryOne<Note>(db, `SELECT * FROM notes WHERE slug = ?`, slug);
}

export async function listNotes(db: Db): Promise<Note[]> {
	return queryAll<Note>(db, `SELECT * FROM notes ORDER BY name`);
}

export async function updateNoteColor(
	db: Db,
	id: string,
	input: { color: string; color_gradient?: string | null },
): Promise<Note | null> {
	await execute(
		db,
		`UPDATE notes SET color = ?, color_gradient = ? WHERE id = ?`,
		input.color,
		input.color_gradient ?? null,
		id,
	);
	return getNoteById(db, id);
}

export async function fillNoteColorIfNull(
	db: Db,
	id: string,
	input: { color: string; color_gradient?: string | null },
): Promise<void> {
	await execute(
		db,
		`UPDATE notes SET color = ?, color_gradient = ? WHERE id = ? AND color IS NULL`,
		input.color,
		input.color_gradient ?? null,
		id,
	);
}
