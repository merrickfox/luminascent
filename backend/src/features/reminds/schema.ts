import { z } from 'zod';

export const createRemindsSchema = z.object({
	reminded_product_id: z.string().optional(),
	external_brand_name: z.string().optional(),
	external_product_name: z.string().optional(),
	external_source_url: z.string().url().optional(),
	thumbs_up: z.number().int().min(0).optional(),
	thumbs_down: z.number().int().min(0).optional(),
});
