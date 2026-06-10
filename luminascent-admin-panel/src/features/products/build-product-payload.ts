import type { CreateProductInput, ProductSizeInput, ScentAccordInput, ScentNoteInput } from '@/lib/types'
import { uploadedImagesToInputs, type UploadedImage } from '@/components/image-uploader'
import { productFormSchema, type ProductFormValues } from '@/features/products/product-form-schema'

export function buildProductPayload(
  values: ProductFormValues,
  extras: {
    notes: ScentNoteInput[]
    accords: ScentAccordInput[]
    uploadedImages: UploadedImage[]
    sizes: ProductSizeInput[]
    id?: string
  },
): CreateProductInput {
  const parsed = productFormSchema.parse(values)
  const imageInputs = uploadedImagesToInputs(extras.uploadedImages)
  const sizeInputs = extras.sizes.map((size, index) => ({
    ...size,
    position: index,
    is_primary: size.is_primary ?? index === 0,
  }))

  return {
    id: extras.id,
    name: parsed.name,
    slug: parsed.slug || undefined,
    category_slug: parsed.category_slug,
    brand_slug: parsed.brand_slug || undefined,
    release_year: parsed.release_year,
    description: parsed.description || undefined,
    wax_type: parsed.wax_type || undefined,
    vessel_material: parsed.vessel_material || undefined,
    is_discontinued: parsed.is_discontinued,
    scent_summary: parsed.scent_summary || undefined,
    sizes: sizeInputs.length > 0 ? sizeInputs : undefined,
    notes: extras.notes.length > 0 ? extras.notes : undefined,
    accords: extras.accords.length > 0 ? extras.accords : undefined,
    images: imageInputs.length > 0 ? imageInputs : undefined,
  }
}
