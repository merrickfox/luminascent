import { z } from 'zod';

export const createReviewSchema = z.object({
	author_name: z.string().optional(),
	rating: z.number().min(0).max(5).optional(),
	title: z.string().optional(),
	body: z.string().min(1),
	language: z.string().optional(),
	helpful_count: z.number().int().min(0).optional(),
	unhelpful_count: z.number().int().min(0).optional(),
	published_at: z.string().optional(),
});
