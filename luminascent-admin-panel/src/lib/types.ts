export type Brand = {
  id: string
  name: string
  slug: string
  country: string | null
  website_url: string | null
  created_at: string
  updated_at: string
}

export type Category = {
  id: string
  name: string
  slug: string
}

export type Note = {
  id: string
  name: string
  slug: string
  note_family: string | null
}

export type Accord = {
  id: string
  name: string
  slug: string
}

export type ProductImage = {
  id: string
  r2_key: string
  url: string
  position: number
  is_primary: boolean
}

export type ProductImageInput = {
  r2_key: string
  position?: number
  is_primary?: boolean
}

export type Product = {
  id: string
  category_id: string
  brand_id: string | null
  name: string
  slug: string
  release_year: number | null
  description: string | null
  image_url: string | null
  wax_type: string | null
  vessel_material: string | null
  is_discontinued: number
  created_at: string
  updated_at: string
}

export type ProductSize = {
  id: string
  product_id: string
  size_value: number | null
  size_unit: string | null
  size_grams: number | null
  price_amount: number | null
  price_currency: string | null
  burn_time_hours: number | null
  sku: string | null
  availability: string | null
  source_url: string | null
  position: number
  is_primary: number
  created_at: string
}

export type ProductSizeInput = {
  size_value?: number | null
  size_unit?: string | null
  size_grams?: number | null
  price_amount?: number | null
  price_currency?: string | null
  burn_time_hours?: number | null
  sku?: string | null
  availability?: string | null
  source_url?: string | null
  position?: number
  is_primary?: boolean
}

export type ProductListFilters = {
  category?: string
  brand?: string
  notes?: string[]
  accords?: string[]
  vote_options?: string[]
  min_rating?: number
  limit?: number
  offset?: number
  sort?: 'name' | 'rating' | 'newest'
}

export type CreateBrandInput = {
  name: string
  slug?: string
  country?: string
  website_url?: string
}

export type CreateCategoryInput = {
  name: string
  slug?: string
}

export type CreateNoteInput = {
  name: string
  slug?: string
  note_family?: string
}

export type CreateAccordInput = {
  name: string
  slug?: string
}

export type ScentNoteInput = {
  note_slug: string
  pyramid_stage?: 'top' | 'middle' | 'base' | 'general' | 'unknown'
  position_index?: number
}

export type ScentAccordInput = {
  accord_slug: string
  strength_score?: number
  position_index?: number
}

export type CreateProductInput = {
  id?: string
  name: string
  slug?: string
  category_slug: string
  brand_slug?: string
  release_year?: number
  description?: string
  image_url?: string
  wax_type?: string
  vessel_material?: string
  is_discontinued?: boolean
  scent_summary?: string
  sizes?: ProductSizeInput[]
  notes?: ScentNoteInput[]
  accords?: ScentAccordInput[]
  images?: ProductImageInput[]
}

export type UpdateProductInput = Partial<CreateProductInput>

export type ScentProfile = {
  id: string
  product_id: string
  summary: string | null
  created_at: string
  updated_at: string
}

export type ScentProfileNote = {
  note: Note
  pyramid_stage: string | null
  position_index: number | null
}

export type ScentProfileAccord = {
  accord: Accord
  strength_score: number | null
  position_index: number | null
}

export type ProductDetail = {
  product: Product
  category: Category
  brand: Brand | null
  scent_profile: ScentProfile | null
  notes: ScentProfileNote[]
  accords: ScentProfileAccord[]
  images: ProductImage[]
  sizes: ProductSize[]
}

export type ApiError = {
  error: string
}

export type ImportProductRecord = {
  source_url?: string
  category_slug: string
  brand_name?: string
  brand_slug?: string
  name: string
  slug?: string
  description?: string | null
  scent_summary?: string | null
  release_year?: number | null
  wax_type?: string | null
  vessel_material?: string | null
  is_discontinued?: boolean
  sizes?: {
    size_value?: number | null
    size_unit?: string | null
    size_grams?: number | null
    price_amount?: number | null
    price_currency?: string | null
    burn_time_hours?: number | null
    sku?: string | null
    availability?: string | null
    source_url?: string | null
    is_primary?: boolean
  }[]
  images?: {
    source_url: string
    position: number
    is_primary: boolean
  }[]
  notes?: {
    note_slug: string
    name: string
    pyramid_stage?: 'top' | 'middle' | 'base' | 'general' | 'unknown'
  }[]
  accords?: {
    accord_slug: string
    name: string
  }[]
}

export type ImportOptions = {
  update_existing: boolean
  refetch_images: boolean
}

export type EnsureBrandInput = {
  name: string
  slug: string
  country?: string
  website_url?: string
}

export type EnsureBrandResult = {
  brand: Brand
  status: 'existing' | 'created'
}

export type ImportProductResult = {
  status: 'created' | 'updated' | 'skipped' | 'failed'
  productId?: string
  slug: string
  notes: { created: number; existing: number }
  accords: { created: number; existing: number }
  images: {
    added: number
    kept: number
    failed: { url: string; error: string }[]
  }
  warnings: string[]
  error?: string
}

export type ParsedImportFile = {
  products: ImportProductRecord[]
  brandName: string
  brandSlug: string
  productCount: number
  imageCount: number
  invalidCount: number
  invalidProducts: { index: number; reason: string }[]
}
