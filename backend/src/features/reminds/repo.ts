import { execute, queryAll, type Db } from '../../lib/db';
import type { RemindsMeOf } from './types';

export async function getRemindsForProduct(db: Db, productId: string): Promise<RemindsMeOf[]> {
	return queryAll<RemindsMeOf>(
		db,
		`SELECT * FROM product_reminds_me_of WHERE product_id = ? ORDER BY thumbs_up DESC`,
		productId,
	);
}

export async function createReminds(
	db: Db,
	productId: string,
	input: {
		reminded_product_id?: string;
		external_brand_name?: string;
		external_product_name?: string;
		external_source_url?: string;
		thumbs_up?: number;
		thumbs_down?: number;
	},
): Promise<void> {
	await execute(
		db,
		`INSERT INTO product_reminds_me_of (
			product_id, reminded_product_id, external_brand_name,
			external_product_name, external_source_url, thumbs_up, thumbs_down
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(product_id, reminded_product_id, external_brand_name, external_product_name)
		DO UPDATE SET
			external_source_url = excluded.external_source_url,
			thumbs_up = excluded.thumbs_up,
			thumbs_down = excluded.thumbs_down`,
		productId,
		input.reminded_product_id ?? null,
		input.external_brand_name ?? null,
		input.external_product_name ?? null,
		input.external_source_url ?? null,
		input.thumbs_up ?? 0,
		input.thumbs_down ?? 0,
	);
}
