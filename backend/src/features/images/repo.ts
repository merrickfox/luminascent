import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { imagePublicUrl } from '../../lib/images';
import { newId } from '../../lib/id';
import type { ProductImage, ProductImageInput, ProductImageResponse } from './types';

export async function listProductImages(
	db: Db,
	productId: string,
	publicBaseUrl: string,
): Promise<ProductImageResponse[]> {
	const rows = await queryAll<ProductImage>(
		db,
		`SELECT * FROM product_images
		 WHERE product_id = ?
		 ORDER BY is_primary DESC, position ASC, created_at ASC`,
		productId,
	);

	return rows.map((row) => toProductImageResponse(row, publicBaseUrl));
}

export async function getProductImageById(
	db: Db,
	imageId: string,
): Promise<ProductImage | null> {
	return queryOne<ProductImage>(db, `SELECT * FROM product_images WHERE id = ?`, imageId);
}

export async function getProductImageByKey(
	db: Db,
	r2Key: string,
): Promise<ProductImage | null> {
	return queryOne<ProductImage>(db, `SELECT * FROM product_images WHERE r2_key = ?`, r2Key);
}

export async function addProductImage(
	db: Db,
	productId: string,
	input: ProductImageInput,
): Promise<ProductImage> {
	const id = newId();
	await execute(
		db,
		`INSERT INTO product_images (id, product_id, r2_key, position, is_primary)
		 VALUES (?, ?, ?, ?, ?)`,
		id,
		productId,
		input.r2_key,
		input.position ?? 0,
		input.is_primary ? 1 : 0,
	);

	const image = await queryOne<ProductImage>(db, `SELECT * FROM product_images WHERE id = ?`, id);
	if (!image) throw new Error('Failed to create product image');
	return image;
}

export async function deleteProductImage(db: Db, imageId: string): Promise<ProductImage | null> {
	const existing = await getProductImageById(db, imageId);
	if (!existing) return null;

	await execute(db, `DELETE FROM product_images WHERE id = ?`, imageId);
	return existing;
}

export async function setProductImages(
	db: Db,
	productId: string,
	images: ProductImageInput[],
): Promise<{ removedKeys: string[] }> {
	const existing = await queryAll<ProductImage>(
		db,
		`SELECT * FROM product_images WHERE product_id = ?`,
		productId,
	);

	const incomingKeys = new Set(images.map((image) => image.r2_key));
	const removedKeys = existing
		.filter((image) => !incomingKeys.has(image.r2_key))
		.map((image) => image.r2_key);

	await execute(db, `DELETE FROM product_images WHERE product_id = ?`, productId);

	for (let index = 0; index < images.length; index++) {
		const image = images[index];
		await execute(
			db,
			`INSERT INTO product_images (id, product_id, r2_key, position, is_primary)
			 VALUES (?, ?, ?, ?, ?)`,
			newId(),
			productId,
			image.r2_key,
			image.position ?? index,
			image.is_primary ? 1 : 0,
		);
	}

	return { removedKeys };
}

export function toProductImageResponse(
	image: ProductImage,
	publicBaseUrl: string,
): ProductImageResponse {
	return {
		id: image.id,
		r2_key: image.r2_key,
		url: imagePublicUrl(publicBaseUrl, image.r2_key),
		position: image.position,
		is_primary: image.is_primary === 1,
	};
}
