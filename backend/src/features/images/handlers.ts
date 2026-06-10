import { Hono } from 'hono';
import {
	ALLOWED_IMAGE_TYPES,
	buildImageKey,
	imagePublicUrl,
	isValidImageKeyForProduct,
	MAX_IMAGE_BYTES,
} from '../../lib/images';
import { newId } from '../../lib/id';
import { badRequest, notFound, serverError } from '../../lib/http';
import {
	deleteProductImage,
	getProductImageById,
	listProductImages,
} from './repo';

export const imageRoutes = new Hono<{ Bindings: Env }>()
	.get('/:id/images', async (c) => {
		const productId = c.req.param('id');
		const images = await listProductImages(c.env.DB, productId, c.env.R2_PUBLIC_BASE_URL);
		return c.json({ images });
	})
	.post('/:id/images', async (c) => {
		const productId = c.req.param('id');
		const body = await c.req.parseBody();
		const file = body.file;

		if (!(file instanceof File)) {
			return badRequest(c, 'Missing file field');
		}

		if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
			return badRequest(c, 'Unsupported image type');
		}

		if (file.size > MAX_IMAGE_BYTES) {
			return badRequest(c, 'Image exceeds maximum size of 10MB');
		}

		const r2Key = buildImageKey(productId, file.type);
		const imageId = newId();

		try {
			await c.env.BUCKET.put(r2Key, file.stream(), {
				httpMetadata: {
					contentType: file.type,
				},
			});
		} catch {
			return serverError(c, 'Failed to upload image');
		}

		return c.json(
			{
				id: imageId,
				r2_key: r2Key,
				url: imagePublicUrl(c.env.R2_PUBLIC_BASE_URL, r2Key),
			},
			201,
		);
	})
	.delete('/:id/images/:imageId', async (c) => {
		const productId = c.req.param('id');
		const imageId = c.req.param('imageId');
		const body = await c.req.json().catch(() => ({}));
		const r2KeyFromBody = typeof body?.r2_key === 'string' ? body.r2_key : undefined;

		let r2Key = r2KeyFromBody;

		if (imageId !== 'draft') {
			const existing = await getProductImageById(c.env.DB, imageId);
			if (!existing) {
				if (!r2Key) return notFound(c, 'Image not found');
			} else {
				if (existing.product_id !== productId) {
					return notFound(c, 'Image not found');
				}
				r2Key = existing.r2_key;
				await deleteProductImage(c.env.DB, imageId);
			}
		}

		if (!r2Key || !isValidImageKeyForProduct(productId, r2Key)) {
			return badRequest(c, 'Invalid image key');
		}

		try {
			await c.env.BUCKET.delete(r2Key);
		} catch {
			return serverError(c, 'Failed to delete image');
		}

		return c.json({ ok: true });
	});
