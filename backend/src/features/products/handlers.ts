import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { badRequest, conflict, notFound, serverError } from '../../lib/http';
import { searchProducts } from './fts';
import {
	createProduct,
	deleteProduct,
	deleteProducts,
	getProductById,
	getProductDetail,
	listProducts,
	setProductRating,
	updateProduct,
} from './repo';
import { bulkDeleteSchema, createProductSchema, setRatingSchema, updateProductSchema } from './schema';
import type { ProductListFilters } from './types';

function parseListFilters(c: { req: { query: (key: string) => string | undefined } }): ProductListFilters {
	const notes = c.req.query('notes');
	const accords = c.req.query('accords');
	const voteOptions = c.req.query('vote_options');
	const minRating = c.req.query('min_rating');

	return {
		category: c.req.query('category'),
		brand: c.req.query('brand'),
		notes: notes ? notes.split(',').filter(Boolean) : undefined,
		accords: accords ? accords.split(',').filter(Boolean) : undefined,
		vote_options: voteOptions ? voteOptions.split(',').filter(Boolean) : undefined,
		min_rating: minRating ? Number(minRating) : undefined,
		limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
		offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
		sort: (c.req.query('sort') as ProductListFilters['sort']) ?? undefined,
	};
}

export const productRoutes = new Hono<{ Bindings: Env }>()
	.get('/', async (c) => {
		const filters = parseListFilters(c);
		const products = await listProducts(c.env.DB, filters);
		return c.json({ products, filters });
	})
	.get('/search', async (c) => {
		const q = c.req.query('q');
		if (!q) return badRequest(c, 'Query parameter q is required');

		const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 20;
		const productIds = await searchProducts(c.env.DB, q, limit);

		const products = await Promise.all(
			productIds.map(async (id) => {
				const product = await getProductById(c.env.DB, id);
				return product;
			}),
		);

		return c.json({ products: products.filter(Boolean), query: q });
	})
	.get('/:slug', async (c) => {
		const detail = await getProductDetail(c.env.DB, c.req.param('slug'), c.env.R2_PUBLIC_BASE_URL);
		if (!detail) return notFound(c, 'Product not found');
		return c.json(detail);
	})
	.post('/', zValidator('json', createProductSchema), async (c) => {
		const input = c.req.valid('json');
		try {
			const product = await createProduct(c.env.DB, input);
			return c.json({ product }, 201);
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('UNIQUE')) {
					return conflict(c, 'Product slug already exists');
				}
				if (
					error.message.startsWith('Unknown category') ||
					error.message.startsWith('Unknown brand') ||
					error.message.startsWith('Unknown note') ||
					error.message.startsWith('Unknown accord') ||
					error.message.startsWith('Invalid image key')
				) {
					return badRequest(c, error.message);
				}
			}
			return serverError(c);
		}
	})
	.post('/bulk-delete', zValidator('json', bulkDeleteSchema), async (c) => {
		const { ids } = c.req.valid('json');
		try {
			const { deleted, notFound, r2Keys } = await deleteProducts(
				c.env.DB,
				ids,
				c.env.R2_PUBLIC_BASE_URL,
			);
			await Promise.all(r2Keys.map((key) => c.env.BUCKET.delete(key).catch(() => {})));
			return c.json({ deleted, notFound });
		} catch {
			return serverError(c);
		}
	})
	.put('/:id', zValidator('json', updateProductSchema), async (c) => {
		const id = c.req.param('id');
		const input = c.req.valid('json');
		try {
			const { product, removedImageKeys } = await updateProduct(c.env.DB, id, input);
			if (!product) return notFound(c, 'Product not found');

			if (removedImageKeys.length > 0) {
				await Promise.all(removedImageKeys.map((key) => c.env.BUCKET.delete(key)));
			}

			return c.json({ product });
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('UNIQUE')) {
					return conflict(c, 'Product slug already exists');
				}
				if (
					error.message.startsWith('Unknown category') ||
					error.message.startsWith('Unknown brand') ||
					error.message.startsWith('Unknown note') ||
					error.message.startsWith('Unknown accord') ||
					error.message.startsWith('Invalid image key')
				) {
					return badRequest(c, error.message);
				}
			}
			return serverError(c);
		}
	})
	.delete('/:id', async (c) => {
		const id = c.req.param('id');
		try {
			const { deleted, r2Keys } = await deleteProduct(c.env.DB, id, c.env.R2_PUBLIC_BASE_URL);
			if (!deleted) return notFound(c, 'Product not found');

			await Promise.all(r2Keys.map((key) => c.env.BUCKET.delete(key).catch(() => {})));
			return c.json({ ok: true });
		} catch {
			return serverError(c);
		}
	})
	.post('/:id/rating', zValidator('json', setRatingSchema), async (c) => {
		const productId = c.req.param('id');
		const product = await getProductById(c.env.DB, productId);
		if (!product) return notFound(c, 'Product not found');

		const input = c.req.valid('json');
		try {
			await setProductRating(c.env.DB, productId, input);
			return c.json({ ok: true });
		} catch {
			return serverError(c);
		}
	});
