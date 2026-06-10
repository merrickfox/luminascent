import { z } from 'zod';
import { productImageInputSchema } from '../images/schema';

const scentNoteInput = z.object({
	note_slug: z.string().min(1),
	pyramid_stage: z.enum(['top', 'middle', 'base', 'general', 'unknown']).optional(),
	position_index: z.number().int().optional(),
});

const scentAccordInput = z.object({
	accord_slug: z.string().min(1),
	strength_score: z.number().min(0).max(1).optional(),
	position_index: z.number().int().optional(),
});

const productSizeInput = z.object({
	size_value: z.number().nullable().optional(),
	size_unit: z.string().nullable().optional(),
	size_grams: z.number().int().nullable().optional(),
	price_amount: z.number().int().nullable().optional(),
	price_currency: z.string().nullable().optional(),
	burn_time_hours: z.number().int().nullable().optional(),
	sku: z.string().nullable().optional(),
	availability: z.string().nullable().optional(),
	source_url: z.string().nullable().optional(),
	position: z.number().int().optional(),
	is_primary: z.boolean().optional(),
});

export const createProductSchema = z.object({
	id: z.string().min(1).optional(),
	name: z.string().min(1),
	slug: z.string().min(1).optional(),
	category_slug: z.string().min(1),
	brand_slug: z.string().min(1).optional(),
	release_year: z.number().int().optional(),
	description: z.string().optional(),
	image_url: z.string().url().optional(),
	wax_type: z.string().optional(),
	vessel_material: z.string().optional(),
	is_discontinued: z.boolean().optional(),
	scent_summary: z.string().optional(),
	sizes: z.array(productSizeInput).optional(),
	notes: z.array(scentNoteInput).optional(),
	accords: z.array(scentAccordInput).optional(),
	images: z.array(productImageInputSchema).optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const setRatingSchema = z.object({
	rating_avg: z.number().min(0).max(5).optional(),
	rating_count: z.number().int().min(0),
});

export const bulkDeleteSchema = z.object({
	ids: z.array(z.string().min(1)).min(1).max(100),
});
