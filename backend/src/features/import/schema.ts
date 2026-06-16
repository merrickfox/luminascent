import { z } from 'zod';

const scrapedSizeSchema = z.object({
	size_value: z.number().nullable().optional(),
	size_unit: z.string().nullable().optional(),
	size_grams: z.number().int().nullable().optional(),
	price_amount: z.number().int().nullable().optional(),
	price_currency: z.string().nullable().optional(),
	burn_time_hours: z.number().int().nullable().optional(),
	sku: z.string().nullable().optional(),
	availability: z.string().nullable().optional(),
	source_url: z.string().nullable().optional(),
	is_primary: z.boolean().optional(),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const scrapedNoteSchema = z.object({
	note_slug: z.string().min(1),
	name: z.string().min(1),
	pyramid_stage: z.enum(['top', 'middle', 'base', 'general', 'unknown']).optional(),
	color: hexColor.optional(),
	color_gradient: z.string().optional(),
});

const scrapedAccordSchema = z.object({
	accord_slug: z.string().min(1),
	name: z.string().min(1),
	color: hexColor.optional(),
	color_gradient: z.string().optional(),
});

const scrapedImageSchema = z
	.object({
		source_url: z.string().url().optional(),
		data_base64: z.string().min(1).optional(),
		content_type: z.string().optional(),
		position: z.number().int().min(0),
		is_primary: z.boolean(),
	})
	.refine((image) => Boolean(image.source_url || image.data_base64), {
		message: 'Image must include source_url or data_base64',
	});

export const scrapedProductSchema = z
	.object({
		source_url: z.string().url().optional(),
		category_slug: z.string().min(1),
		brand_name: z.string().min(1).optional(),
		brand_slug: z.string().min(1).optional(),
		name: z.string().min(1),
		slug: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		scent_summary: z.string().nullable().optional(),
		release_year: z.number().int().nullable().optional(),
		wax_type: z.string().nullable().optional(),
		vessel_material: z.string().nullable().optional(),
		is_discontinued: z.boolean().optional(),
		sizes: z.array(scrapedSizeSchema).optional(),
		images: z.array(scrapedImageSchema).optional(),
		notes: z.array(scrapedNoteSchema).optional(),
		accords: z.array(scrapedAccordSchema).optional(),
	})
	.passthrough();

export const importOptionsSchema = z.object({
	update_existing: z.boolean().default(true),
	refetch_images: z.boolean().default(false),
});

export const importProductRequestSchema = z.object({
	product: scrapedProductSchema,
	options: importOptionsSchema.optional(),
});

export const ensureBrandSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1),
	country: z.string().optional(),
	website_url: z.string().url().optional(),
});

export type ScrapedProduct = z.infer<typeof scrapedProductSchema>;
