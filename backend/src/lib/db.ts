export type Db = D1Database;

export async function queryAll<T>(db: Db, sql: string, ...params: unknown[]): Promise<T[]> {
	const result = await db.prepare(sql).bind(...params).all<T>();
	return result.results ?? [];
}

export async function queryOne<T>(db: Db, sql: string, ...params: unknown[]): Promise<T | null> {
	const result = await db.prepare(sql).bind(...params).first<T>();
	return result ?? null;
}

export async function execute(db: Db, sql: string, ...params: unknown[]): Promise<void> {
	await db.prepare(sql).bind(...params).run();
}
