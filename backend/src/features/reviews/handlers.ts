import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { type AuthContext, supabaseAuth } from '../../lib/auth';
import { badRequest, notFound, serverError } from '../../lib/http';
import { rebuildProductSearch } from '../products/fts';
import { getProductById } from '../products/repo';
import { getUserById } from '../users/repo';
import {
	getAdminReviewById,
	getReviewCounts,
	getUserReviewProfile,
	listReviewsForAdmin,
	setReviewStatus,
	submitUserReview,
} from './repo';
import { moderateSchema, reviewListQuerySchema, submitReviewSchema } from './schema';

/** Public, authenticated review submission. Mounted at /products. */
export const reviewRoutes = new Hono<AuthContext>()
	.use('*', supabaseAuth)
	.post('/:id/reviews', zValidator('json', submitReviewSchema), async (c) => {
		const auth = c.get('user');
		const product = await getProductById(c.env.DB, c.req.param('id'));
		if (!product) return notFound(c, 'Product not found');

		const user = await getUserById(c.env.DB, auth.id);
		const authorName = user?.username ?? null;

		try {
			const review = await submitUserReview(c.env.DB, product.id, auth.id, authorName, c.req.valid('json'));
			// Pending reviews are not indexed; FTS rebuild happens on approval.
			return c.json({ review, status: 'pending' as const }, 201);
		} catch {
			return serverError(c);
		}
	});

/** Admin moderation queue. Mounted under /admin/reviews (apiKeyAuth). */
export const reviewAdminRoutes = new Hono<{ Bindings: Env }>()
	.get('/', zValidator('query', reviewListQuerySchema), async (c) => {
		const filters = c.req.valid('query');
		const [reviews, counts] = await Promise.all([
			listReviewsForAdmin(c.env.DB, filters),
			getReviewCounts(c.env.DB),
		]);
		return c.json({ reviews, counts });
	})
	.get('/user/:userId', async (c) => {
		const profile = await getUserReviewProfile(c.env.DB, c.req.param('userId'));
		if (!profile) return notFound(c, 'User not found');
		return c.json(profile);
	})
	.get('/:id', async (c) => {
		const review = await getAdminReviewById(c.env.DB, c.req.param('id'));
		if (!review) return notFound(c, 'Review not found');
		return c.json({ review });
	})
	.post('/:id/approve', zValidator('json', moderateSchema), async (c) => {
		const id = c.req.param('id');
		if (!(await getAdminReviewById(c.env.DB, id))) return notFound(c, 'Review not found');
		const review = await setReviewStatus(c.env.DB, id, 'approved', c.req.valid('json').note);
		if (!review) return badRequest(c, 'Failed to update review');
		await rebuildProductSearch(c.env.DB, review.product_id);
		return c.json({ review });
	})
	.post('/:id/reject', zValidator('json', moderateSchema), async (c) => {
		const id = c.req.param('id');
		if (!(await getAdminReviewById(c.env.DB, id))) return notFound(c, 'Review not found');
		const review = await setReviewStatus(c.env.DB, id, 'rejected', c.req.valid('json').note);
		if (!review) return badRequest(c, 'Failed to update review');
		// A previously-approved review that's now rejected must leave the index.
		await rebuildProductSearch(c.env.DB, review.product_id);
		return c.json({ review });
	});
