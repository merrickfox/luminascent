import { execute, queryAll, queryOne, type Db } from '../../lib/db';

type FtsRow = {
	product_id: string;
	name: string;
	brand_name: string | null;
	description: string | null;
	notes: string;
	accords: string;
	reviews: string;
};

export async function rebuildProductSearch(db: Db, productId: string): Promise<void> {
	const row = await queryOne<FtsRow>(
		db,
		`SELECT
			p.id AS product_id,
			p.name,
			b.name AS brand_name,
			p.description,
			COALESCE(REPLACE(GROUP_CONCAT(DISTINCT n.name), ',', ' '), '') AS notes,
			COALESCE(REPLACE(GROUP_CONCAT(DISTINCT a.name), ',', ' '), '') AS accords,
			COALESCE(REPLACE(GROUP_CONCAT(DISTINCT SUBSTR(r.body, 1, 200)), ',', ' '), '') AS reviews
		FROM products p
		LEFT JOIN brands b ON b.id = p.brand_id
		LEFT JOIN scent_profiles sp ON sp.product_id = p.id
		LEFT JOIN scent_profile_notes spn ON spn.scent_profile_id = sp.id
		LEFT JOIN notes n ON n.id = spn.note_id
		LEFT JOIN scent_profile_accords spa ON spa.scent_profile_id = sp.id
		LEFT JOIN accords a ON a.id = spa.accord_id
		LEFT JOIN reviews r ON r.product_id = p.id AND r.status = 'approved'
		WHERE p.id = ?
		GROUP BY p.id`,
		productId,
	);

	if (!row) return;

	await execute(db, `DELETE FROM product_search WHERE product_id = ?`, productId);
	await execute(
		db,
		`INSERT INTO product_search (product_id, name, brand_name, description, notes, accords, reviews)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		row.product_id,
		row.name,
		row.brand_name ?? '',
		row.description ?? '',
		row.notes,
		row.accords,
		row.reviews,
	);
}

export async function searchProducts(db: Db, query: string, limit = 20): Promise<string[]> {
	const rows = await queryAll<{ product_id: string }>(
		db,
		`SELECT product_id FROM product_search WHERE product_search MATCH ? LIMIT ?`,
		query,
		limit,
	);
	return rows.map((r) => r.product_id);
}
