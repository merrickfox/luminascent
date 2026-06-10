import { z } from 'zod';

export const setVoteAggregatesSchema = z.object({
	votes: z.array(
		z.object({
			vote_option_slug: z.string().min(1),
			vote_count: z.number().int().min(0),
		}),
	),
});
