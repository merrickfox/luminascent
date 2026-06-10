import { z } from 'zod';

export const productImageInputSchema = z.object({
	r2_key: z.string().min(1),
	position: z.number().int().min(0).optional(),
	is_primary: z.boolean().optional(),
});

export const productImagesInputSchema = z.array(productImageInputSchema);
