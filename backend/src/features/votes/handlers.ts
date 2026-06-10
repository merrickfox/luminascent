import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { badRequest, notFound, serverError } from '../../lib/http';
import { getProductById } from '../products/repo';
import { setVoteAggregates } from './repo';
import { setVoteAggregatesSchema } from './schema';

export const voteRoutes = new Hono<{ Bindings: Env }>().post(
	'/:id/votes',
	zValidator('json', setVoteAggregatesSchema),
	async (c) => {
		const productId = c.req.param('id');
		const product = await getProductById(c.env.DB, productId);
		if (!product) return notFound(c, 'Product not found');

		const input = c.req.valid('json');
		try {
			await setVoteAggregates(c.env.DB, productId, input.votes);
			return c.json({ ok: true });
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Unknown vote option')) {
				return badRequest(c, error.message);
			}
			return serverError(c);
		}
	},
);
