import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { conflict, notFound, serverError } from '../../lib/http';
import { createBrand, deleteBrand, getBrandBySlug, listBrands, updateBrand } from './repo';
import { createBrandSchema, updateBrandSchema } from './schema';

export const brandRoutes = new Hono<{ Bindings: Env }>()
	.get('/', async (c) => {
		const brands = await listBrands(c.env.DB);
		return c.json({ brands });
	})
	.get('/:slug', async (c) => {
		const brand = await getBrandBySlug(c.env.DB, c.req.param('slug'));
		if (!brand) return notFound(c, 'Brand not found');
		return c.json({ brand });
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
	})
	.patch('/:id', zValidator('json', updateBrandSchema), async (c) => {
		const id = c.req.param('id');
		const input = c.req.valid('json');
		try {
			const brand = await updateBrand(c.env.DB, id, input);
			if (!brand) return notFound(c, 'Brand not found');
			return c.json({ brand });
		} catch (error) {
			if (error instanceof Error && error.message.includes('UNIQUE')) {
				return conflict(c, 'Brand slug already exists');
			}
			return serverError(c);
		}
	})
	.delete('/:id', async (c) => {
		const id = c.req.param('id');
		try {
			const deleted = await deleteBrand(c.env.DB, id);
			if (!deleted) return notFound(c, 'Brand not found');
			return c.json({ ok: true });
		} catch (error) {
			if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
				return conflict(c, 'Cannot delete brand: products are still assigned to it');
			}
			return serverError(c);
		}
	});
