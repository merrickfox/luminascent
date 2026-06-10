import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { conflict, serverError } from '../../lib/http';
import { createBrand, listBrands } from './repo';
import { createBrandSchema } from './schema';

export const brandRoutes = new Hono<{ Bindings: Env }>()
	.get('/', async (c) => {
		const brands = await listBrands(c.env.DB);
		return c.json({ brands });
	})
	.post('/', zValidator('json', createBrandSchema), async (c) => {
		const input = c.req.valid('json');
		try {
			const brand = await createBrand(c.env.DB, input);
			return c.json({ brand }, 201);
		} catch (error) {
			if (error instanceof Error && error.message.includes('UNIQUE')) {
				return conflict(c, 'Brand slug already exists');
			}
			return serverError(c);
		}
	});
