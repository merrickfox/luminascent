import { z } from 'zod';

// Admin/import bulk aggregate setter (unchanged).
export const setVoteAggregatesSchema = z.object({
	votes: z.array(
		z.object({
			vote_option_slug: z.string().min(1),
			vote_count: z.number().int().min(0),
		}),
	),
});

// Per-user vote. `dimension_slug` disambiguates option slugs, which are only
// unique within a dimension (e.g. `moderate` exists in longevity and sillage).
export const castVoteSchema = z.object({
	dimension_slug: z.string().min(1),
	option_slug: z.string().min(1),
});

export const removeVoteSchema = z.object({
	dimension_slug: z.string().min(1),
});
