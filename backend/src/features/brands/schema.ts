import { z } from 'zod';

export const createBrandSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1).optional(),
	country: z.string().optional(),
	website_url: z.string().url().optional(),
});

// Partial for updates; allow an empty string on website_url so a value can be
// cleared (the create schema only accepts a valid URL or omission).
export const updateBrandSchema = z.object({
	name: z.string().min(1).optional(),
	slug: z.string().min(1).optional(),
	country: z.string().optional(),
	website_url: z.string().url().optional().or(z.literal('')),
});
