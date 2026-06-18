import { z } from 'zod';

/** A signed-in user's review submission. */
export const submitReviewSchema = z.object({
	rating: z.number().int().min(1).max(5),
	title: z.string().trim().max(120).optional(),
	body: z.string().trim().min(1).max(5000),
});

/** Optional moderator note, shared by approve/reject. */
export const moderateSchema = z.object({
	note: z.string().trim().max(1000).optional(),
});

/** Admin queue list filters. */
export const reviewListQuerySchema = z.object({
	status: z.enum(['pending', 'approved', 'rejected']).optional(),
	product_id: z.string().optional(),
	user_id: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
	offset: z.coerce.number().int().min(0).optional(),
});
