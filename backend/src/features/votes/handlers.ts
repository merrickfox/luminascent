import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { type AuthContext, supabaseAuth } from '../../lib/auth';
import { badRequest, notFound, serverError } from '../../lib/http';
import { getProductById } from '../products/repo';
import {
	castVote,
	getUserVotesForProduct,
	getVoteAggregatesForProduct,
	getVoteDimensionCatalog,
	removeUserVote,
	setVoteAggregates,
} from './repo';
import { castVoteSchema, removeVoteSchema, setVoteAggregatesSchema } from './schema';

/** Admin/import bulk aggregate setter. Mounted ONLY under /admin. */
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

/** The full votable catalog (dimensions + options). Public, mounted at /vote-dimensions. */
export const voteDimensionRoutes = new Hono<{ Bindings: Env }>().get('/', async (c) => {
	const dimensions = await getVoteDimensionCatalog(c.env.DB);
	return c.json({ dimensions });
});

/** Per-user community voting. All routes require a Supabase session. Mounted at /products. */
export const userVoteRoutes = new Hono<AuthContext>()
	.use('*', supabaseAuth)
	.get('/:id/my-votes', async (c) => {
		const user = c.get('user');
		const product = await getProductById(c.env.DB, c.req.param('id'));
		if (!product) return notFound(c, 'Product not found');
		const myVotes = await getUserVotesForProduct(c.env.DB, user.id, product.id);
		return c.json({ my_votes: myVotes });
	})
	.post('/:id/vote', zValidator('json', castVoteSchema), async (c) => {
		const user = c.get('user');
		const product = await getProductById(c.env.DB, c.req.param('id'));
		if (!product) return notFound(c, 'Product not found');

		const { dimension_slug, option_slug } = c.req.valid('json');
		try {
			await castVote(c.env.DB, user.id, product.id, dimension_slug, option_slug);
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Unknown vote')) {
				return badRequest(c, error.message);
			}
			return serverError(c);
		}
		return c.json({
			votes: await getVoteAggregatesForProduct(c.env.DB, product.id),
			my_votes: await getUserVotesForProduct(c.env.DB, user.id, product.id),
		});
	})
	.delete('/:id/vote', zValidator('json', removeVoteSchema), async (c) => {
		const user = c.get('user');
		const product = await getProductById(c.env.DB, c.req.param('id'));
		if (!product) return notFound(c, 'Product not found');

		try {
			await removeUserVote(c.env.DB, user.id, product.id, c.req.valid('json').dimension_slug);
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Unknown vote')) {
				return badRequest(c, error.message);
			}
			return serverError(c);
		}
		return c.json({
			votes: await getVoteAggregatesForProduct(c.env.DB, product.id),
			my_votes: await getUserVotesForProduct(c.env.DB, user.id, product.id),
		});
	});
