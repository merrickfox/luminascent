import { z } from 'zod';

export const createBrandSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1).optional(),
	country: z.string().optional(),
	website_url: z.string().url().optional(),
});
