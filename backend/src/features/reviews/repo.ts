import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import type { User } from '../users/types';
import type { AdminReview, Review, ReviewCounts, ReviewStatus } from './types';

/** Approved reviews for the public product detail. */
export async function getReviewsForProduct(db: Db, productId: string): Promise<Review[]> {
	return queryAll<Review>(
		db,
		`SELECT * FROM reviews
		 WHERE product_id = ? AND status = 'approved'
		 ORDER BY published_at DESC, created_at DESC`,
		productId,
	);
}

/**
 * Submit (or re-submit) the current user's review for a product. One review per
 * (user, product): a re-submission overwrites the previous one and resets it to
 * pending moderation.
 */
export async function submitUserReview(
	db: Db,
	productId: string,
	userId: string,
	authorName: string | null,
	input: { rating: number; title?: string; body: string },
): Promise<Review> {
	const existing = await queryOne<Review>(
		db,
		`SELECT * FROM reviews WHERE user_id = ? AND product_id = ?`,
		userId,
		productId,
	);

	if (existing) {
		await execute(
			db,
			`UPDATE reviews
			 SET author_name = ?, rating = ?, title = ?, body = ?,
			     status = 'pending', moderated_at = NULL, moderation_note = NULL,
			     created_at = CURRENT_TIMESTAMP
			 WHERE id = ?`,
			authorName,
			input.rating,
			input.title ?? null,
			input.body,
			existing.id,
		);
		const updated = await queryOne<Review>(db, `SELECT * FROM reviews WHERE id = ?`, existing.id);
		if (!updated) throw new Error('Failed to update review');
		return updated;
	}

	const id = newId();
	await execute(
		db,
		`INSERT INTO reviews (id, product_id, user_id, author_name, rating, title, body, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
		id,
		productId,
		userId,
		authorName,
		input.rating,
		input.title ?? null,
		input.body,
	);
	const review = await queryOne<Review>(db, `SELECT * FROM reviews WHERE id = ?`, id);
	if (!review) throw new Error('Failed to create review');
	return review;
}

const ADMIN_SELECT = `
	SELECT r.*, p.name AS product_name, p.slug AS product_slug,
	       u.username AS user_username, u.email AS user_email
	FROM reviews r
	JOIN products p ON p.id = r.product_id
	LEFT JOIN users u ON u.id = r.user_id`;

export async function listReviewsForAdmin(
	db: Db,
	filters: { status?: ReviewStatus; product_id?: string; user_id?: string; limit?: number; offset?: number },
): Promise<AdminReview[]> {
	const where: string[] = [];
	const params: unknown[] = [];
	if (filters.status) {
		where.push('r.status = ?');
		params.push(filters.status);
	}
	if (filters.product_id) {
		where.push('r.product_id = ?');
		params.push(filters.product_id);
	}
	if (filters.user_id) {
		where.push('r.user_id = ?');
		params.push(filters.user_id);
	}
	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const limit = filters.limit ?? 100;
	const offset = filters.offset ?? 0;
	return queryAll<AdminReview>(
		db,
		`${ADMIN_SELECT} ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
		...params,
		limit,
		offset,
	);
}

export async function getAdminReviewById(db: Db, id: string): Promise<AdminReview | null> {
	return queryOne<AdminReview>(db, `${ADMIN_SELECT} WHERE r.id = ?`, id);
}

export async function getReviewCounts(db: Db): Promise<ReviewCounts> {
	const rows = await queryAll<{ status: ReviewStatus; n: number }>(
		db,
		`SELECT status, COUNT(*) AS n FROM reviews GROUP BY status`,
	);
	const counts: ReviewCounts = { pending: 0, approved: 0, rejected: 0 };
	for (const row of rows) {
		if (row.status in counts) counts[row.status] = row.n;
	}
	return counts;
}

/** Set a review's moderation status. Returns the updated row (incl. product_id). */
export async function setReviewStatus(
	db: Db,
	id: string,
	status: ReviewStatus,
	note?: string,
): Promise<Review | null> {
	await execute(
		db,
		`UPDATE reviews
		 SET status = ?, moderation_note = ?, moderated_at = CURRENT_TIMESTAMP,
		     published_at = CASE WHEN ? = 'approved' AND published_at IS NULL THEN CURRENT_TIMESTAMP ELSE published_at END
		 WHERE id = ?`,
		status,
		note ?? null,
		status,
		id,
	);
	return queryOne<Review>(db, `SELECT * FROM reviews WHERE id = ?`, id);
}

export async function getUserReviewProfile(
	db: Db,
	userId: string,
): Promise<{ user: User; stats: ReviewCounts & { total: number }; reviews: AdminReview[] } | null> {
	const user = await queryOne<User>(db, `SELECT * FROM users WHERE id = ?`, userId);
	if (!user) return null;

	const reviews = await listReviewsForAdmin(db, { user_id: userId, limit: 200 });
	const stats = { pending: 0, approved: 0, rejected: 0, total: reviews.length };
	for (const r of reviews) {
		if (r.status in stats) stats[r.status] += 1;
	}
	return { user, stats, reviews };
}
