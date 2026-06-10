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

export type ProductRatingSummary = {
  product_id: string
  rating_avg: number | null
  rating_count: number
  updated_at: string
}

export type ProductImage = {
  id: string
  r2_key: string
  url: string
  position: number
  is_primary: boolean
}

export type ProductSize = {
  id: string
  product_id: string
  size_value: number | null
  size_unit: string | null
  size_grams: number | null
  price_amount: number | null // minor units (pence/cents)
  price_currency: string | null
  burn_time_hours: number | null
  sku: string | null
  availability: string | null
  source_url: string | null
  position: number
  is_primary: number
  created_at: string
}

export type Review = {
  id: string
  product_id: string
  author_name: string | null
  rating: number | null
  title: string | null
  body: string
  language: string | null
  helpful_count: number | null
  unhelpful_count: number | null
  published_at: string | null
  created_at: string
}

export type VoteAggregate = {
  product_id: string
  vote_option_id: string
  vote_count: number
  option_slug: string
  option_label: string
  dimension_slug: string
  dimension_name: string
}

export type ProductDetail = {
  product: Product
  category: Category
  brand: Brand | null
  scent_profile: ScentProfile | null
  notes: ScentProfileNote[]
  accords: ScentProfileAccord[]
  votes: VoteAggregate[]
  rating: ProductRatingSummary | null
  reminds: unknown[]
  reviews: Review[]
  images: ProductImage[]
  sizes: ProductSize[]
}

export type ProductListFilters = {
  category?: string
  brand?: string
  notes?: string
  accords?: string
  vote_options?: string
  min_rating?: number
  limit?: number
  offset?: number
  sort?: 'name' | 'rating' | 'newest'
}

export type ProductsResponse = {
  products: Product[]
  filters: ProductListFilters
}
