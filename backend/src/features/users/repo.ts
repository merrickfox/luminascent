import { execute, queryOne, type Db } from '../../lib/db';
import type { User } from './types';

export async function getUserById(db: Db, id: string): Promise<User | null> {
	return queryOne<User>(db, `SELECT * FROM users WHERE id = ?`, id);
}

export async function getUserByUsername(db: Db, username: string): Promise<User | null> {
	return queryOne<User>(db, `SELECT * FROM users WHERE username = ?`, username);
}

/**
 * Create the registry row for a Supabase user, or refresh the email of an
 * existing one. Idempotent on `id` and deliberately does NOT overwrite the
 * username on repeat calls (logins). Throws on a UNIQUE username collision.
 */
export async function createUser(
	db: Db,
	input: { id: string; username: string; email: string },
): Promise<User> {
	await execute(
		db,
		`INSERT INTO users (id, username, email) VALUES (?, ?, ?)`,
		input.id,
		input.username,
		input.email,
	);
	const user = await getUserById(db, input.id);
	if (!user) throw new Error('Failed to create user');
	return user;
}

/** Refresh the stored email if Supabase reports a different one. */
export async function syncEmail(db: Db, id: string, email: string): Promise<void> {
	await execute(
		db,
		`UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ? AND email != ?`,
		email,
		id,
		email,
	);
}

export async function updateProfile(db: Db, id: string, input: { username: string }): Promise<User | null> {
	await execute(
		db,
		`UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?`,
		input.username,
		id,
	);
	return getUserById(db, id);
}
