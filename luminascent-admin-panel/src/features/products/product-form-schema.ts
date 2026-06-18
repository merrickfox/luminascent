import { z } from 'zod'

export const optionalInt = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === '' || value === undefined) return undefined
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  })

export const productFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
  category_slug: z.string().min(1, 'Category is required'),
  brand_slug: z.string().optional(),
  release_year: optionalInt,
  description: z.string().optional(),
  wax_type: z.string().optional(),
  vessel_material: z.string().optional(),
  is_discontinued: z.boolean().optional(),
  scent_summary: z.string().optional(),
})

export type ProductFormValues = z.input<typeof productFormSchema>

export const productFormDefaults: ProductFormValues = {
  name: '',
  slug: '',
  category_slug: '',
  brand_slug: '',
  description: '',
  wax_type: '',
  vessel_material: '',
  scent_summary: '',
  is_discontinued: false,
}
