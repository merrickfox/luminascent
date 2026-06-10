import { execute, queryAll, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import type { ProductSize, ProductSizeInput } from './types';

export type { ProductSize, ProductSizeInput };

export async function listProductSizes(db: Db, productId: string): Promise<ProductSize[]> {
	return queryAll<ProductSize>(
		db,
		`SELECT * FROM product_sizes WHERE product_id = ? ORDER BY position, is_primary DESC, size_grams`,
		productId,
	);
}

export async function setProductSizes(
	db: Db,
	productId: string,
	sizes: ProductSizeInput[],
): Promise<void> {
	await execute(db, `DELETE FROM product_sizes WHERE product_id = ?`, productId);

	for (let index = 0; index < sizes.length; index++) {
		const size = sizes[index];
		await execute(
			db,
			`INSERT INTO product_sizes (
				id, product_id, size_value, size_unit, size_grams, price_amount, price_currency,
				burn_time_hours, sku, availability, source_url, position, is_primary
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			newId(),
			productId,
			size.size_value ?? null,
			size.size_unit ?? null,
			size.size_grams ?? null,
			size.price_amount ?? null,
			size.price_currency ?? null,
			size.burn_time_hours ?? null,
			size.sku ?? null,
			size.availability ?? null,
			size.source_url ?? null,
			size.position ?? index,
			size.is_primary ? 1 : 0,
		);
	}
}
