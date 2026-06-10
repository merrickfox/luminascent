import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { badRequest, notFound, serverError } from '../../lib/http';
import { getProductById } from '../products/repo';
import { createReminds } from './repo';
import { createRemindsSchema } from './schema';

export const remindsRoutes = new Hono<{ Bindings: Env }>().post(
	'/:id/reminds',
	zValidator('json', createRemindsSchema),
	async (c) => {
		const productId = c.req.param('id');
		const product = await getProductById(c.env.DB, productId);
		if (!product) return notFound(c, 'Product not found');

		const input = c.req.valid('json');
		if (!input.reminded_product_id && !input.external_product_name) {
			return badRequest(c, 'Provide reminded_product_id or external_product_name');
		}

		try {
			await createReminds(c.env.DB, productId, input);
			return c.json({ ok: true }, 201);
		} catch {
			return serverError(c);
		}
	},
);
