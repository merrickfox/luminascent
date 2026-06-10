import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import type { Review } from './types';

export async function getReviewsForProduct(db: Db, productId: string): Promise<Review[]> {
	return queryAll<Review>(
		db,
		`SELECT * FROM reviews WHERE product_id = ? ORDER BY published_at DESC, created_at DESC`,
		productId,
	);
}

export async function createReview(
	db: Db,
	productId: string,
	input: {
		author_name?: string;
		rating?: number;
		title?: string;
		body: string;
		language?: string;
		helpful_count?: number;
		unhelpful_count?: number;
		published_at?: string;
	},
): Promise<Review> {
	const id = newId();

	await execute(
		db,
		`INSERT INTO reviews (
			id, product_id, author_name, rating, title, body, language,
			helpful_count, unhelpful_count, published_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		productId,
		input.author_name ?? null,
		input.rating ?? null,
		input.title ?? null,
		input.body,
		input.language ?? null,
		input.helpful_count ?? null,
		input.unhelpful_count ?? null,
		input.published_at ?? null,
	);

	const review = await queryOne<Review>(db, `SELECT * FROM reviews WHERE id = ?`, id);
	if (!review) throw new Error('Failed to create review');
	return review;
}
