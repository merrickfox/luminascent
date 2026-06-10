import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
import type { Note } from './types';

export async function createNote(
	db: Db,
	input: { name: string; slug?: string; note_family?: string },
): Promise<Note> {
	const id = newId();
	const slug = input.slug ?? slugify(input.name);

	await execute(
		db,
		`INSERT INTO notes (id, name, slug, note_family) VALUES (?, ?, ?, ?)`,
		id,
		input.name,
		slug,
		input.note_family ?? null,
	);

	const note = await queryOne<Note>(db, `SELECT * FROM notes WHERE id = ?`, id);
	if (!note) throw new Error('Failed to create note');
	return note;
}

export async function getNoteBySlug(db: Db, slug: string): Promise<Note | null> {
	return queryOne<Note>(db, `SELECT * FROM notes WHERE slug = ?`, slug);
}

export async function listNotes(db: Db): Promise<Note[]> {
	return queryAll<Note>(db, `SELECT * FROM notes ORDER BY name`);
}
