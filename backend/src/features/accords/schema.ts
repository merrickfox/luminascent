import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const createAccordSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1).optional(),
	color: hexColor.optional(),
	color_gradient: z.string().optional(),
});

export const updateAccordColorSchema = z.object({
	color: hexColor,
	color_gradient: z.string().nullable().optional(),
});
