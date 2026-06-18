import { DurableObject } from 'cloudflare:workers';
import { migrateSchema } from '../utils/doMigrations';

/**
 * Per-user durable storage. One instance per user, addressed by the Supabase
 * user id via `idFromName(userId)` (see `lib/userStore.ts`).
 *
 * This iteration only establishes the plumbing — the SQLite schema is created
 * and versioned through `migrateSchema`, and a couple of stub RPC methods prove
 * the binding end-to-end. Future per-user features (favourites, collections,
 * wishlists) add migrations to `this.migrations` and methods here.
 */
export class UserStore extends DurableObject<Env> {
	private sql: SqlStorage;

	// Append-only list; each entry advances the schema by one version.
	private migrations = [
		// v1: favourited products (not yet surfaced via the API).
		() => {
			this.sql.exec(`
				CREATE TABLE IF NOT EXISTS favourites (
					product_id TEXT PRIMARY KEY,
					created_at TEXT NOT NULL DEFAULT (datetime('now'))
				);
			`);
		},
	];

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		ctx.blockConcurrencyWhile(async () => {
			migrateSchema(this.sql, 'favourites', this.migrations);
		});
	}

	/** Liveness check — proves the binding + migration ran. */
	ping(): { ok: true } {
		return { ok: true };
	}

	/** Placeholder reader for the future favourites feature. */
	getFavourites(): string[] {
		return this.sql
			.exec('SELECT product_id FROM favourites ORDER BY created_at DESC')
			.toArray()
			.map((row) => String(row.product_id));
	}
}
