import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { badRequest, conflict, serverError } from '../../lib/http';
import { validationFailed } from '../../lib/zod-validation';
import { ensureBrandSchema, importProductRequestSchema } from './schema';
import { ensureBrand, importProduct } from './service';

const importValidationHook = (result: { success: boolean; error?: import('zod').ZodError }, c: import('hono').Context) => {
	if (!result.success && result.error) {
		return validationFailed(c, result.error);
	}
};

export const importRoutes = new Hono<{ Bindings: Env }>()
	.post('/brand', zValidator('json', ensureBrandSchema, importValidationHook), async (c) => {
		const input = c.req.valid('json');

		try {
			const result = await ensureBrand(c.env.DB, input);
			return c.json(result, result.status === 'created' ? 201 : 200);
		} catch (error) {
			if (error instanceof Error && error.message.includes('UNIQUE')) {
				return conflict(c, 'Brand slug already exists');
			}
			return serverError(c);
		}
	})
	.post('/product', zValidator('json', importProductRequestSchema, importValidationHook), async (c) => {
		const { product, options } = c.req.valid('json');

		try {
			const result = await importProduct(c.env, product, {
				update_existing: options?.update_existing ?? true,
				refetch_images: options?.refetch_images ?? false,
			});
			if (result.status === 'failed' && result.error) {
				console.error(`[import:product] slug=${result.slug} failed: ${result.error}`);
			}
			return c.json({ result });
		} catch (error) {
			if (error instanceof Error) {
				console.error(`[import:product] slug=${product.slug ?? product.name}: ${error.message}`);
				return badRequest(c, error.message);
			}
			return serverError(c);
		}
	});
