import { z } from 'zod';

/** 3–30 chars, lowercased, `[a-z0-9_]` only. */
export const usernameSchema = z
	.string()
	.trim()
	.min(3, 'Username must be at least 3 characters')
	.max(30, 'Username must be at most 30 characters')
	.transform((s) => s.toLowerCase())
	.refine((s) => /^[a-z0-9_]+$/.test(s), 'Username may only contain lowercase letters, numbers, and underscores');

/** Body for POST /me. Username is optional: required only when creating a row. */
export const ensureUserSchema = z.object({
	username: usernameSchema.optional(),
});

/** Body for PATCH /me. */
export const updateProfileSchema = z.object({
	username: usernameSchema,
});
