import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { conflict, serverError } from '../../lib/http';
import { createCategory, listCategories } from './repo';
import { createCategorySchema } from './schema';

export const categoryRoutes = new Hono<{ Bindings: Env }>()
	.get('/', async (c) => {
		const categories = await listCategories(c.env.DB);
		return c.json({ categories });
	})
	.post('/', zValidator('json', createCategorySchema), async (c) => {
		const input = c.req.valid('json');
		try {
			const category = await createCategory(c.env.DB, input);
			return c.json({ category }, 201);
		} catch (error) {
			if (error instanceof Error && error.message.includes('UNIQUE')) {
				return conflict(c, 'Category slug already exists');
			}
			return serverError(c);
		}
	});
