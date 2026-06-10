import type { D1Database } from '@cloudflare/workers-types';
import { MIGRATION_SQL } from './schema-sql';

async function execStatements(db: D1Database, sql: string): Promise<void> {
	const statements = sql
		.split(';')
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith('--'));

	for (const statement of statements) {
		await db.prepare(statement).run();
	}
}

export async function applyMigrations(db: D1Database): Promise<void> {
	await execStatements(db, MIGRATION_SQL);
}
