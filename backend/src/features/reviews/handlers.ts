import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { notFound, serverError } from '../../lib/http';
import { rebuildProductSearch } from '../products/fts';
import { getProductById } from '../products/repo';
import { createReview } from './repo';
import { createReviewSchema } from './schema';

export const reviewRoutes = new Hono<{ Bindings: Env }>().post(
	'/:id/reviews',
	zValidator('json', createReviewSchema),
	async (c) => {
		const productId = c.req.param('id');
		const product = await getProductById(c.env.DB, productId);
		if (!product) return notFound(c, 'Product not found');

		const input = c.req.valid('json');
		try {
			const review = await createReview(c.env.DB, productId, input);
			await rebuildProductSearch(c.env.DB, productId);
			return c.json({ review }, 201);
		} catch {
			return serverError(c);
		}
	},
);
