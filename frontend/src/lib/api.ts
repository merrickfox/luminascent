import type {
  Brand,
  Category,
  ProductDetail,
  ProductListFilters,
  ProductsResponse,
} from '../types/api'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8023'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message = typeof body.error === 'string' ? body.error : response.statusText
    throw new Error(message || `Request failed (${response.status})`)
  }

  return response.json() as Promise<T>
}

function buildQuery(filters: ProductListFilters): string {
  const params = new URLSearchParams()

  if (filters.category) params.set('category', filters.category)
  if (filters.brand) params.set('brand', filters.brand)
  if (filters.notes) params.set('notes', filters.notes)
  if (filters.accords) params.set('accords', filters.accords)
  if (filters.vote_options) params.set('vote_options', filters.vote_options)
  if (filters.min_rating != null) params.set('min_rating', String(filters.min_rating))
  if (filters.limit != null) params.set('limit', String(filters.limit))
  if (filters.offset != null) params.set('offset', String(filters.offset))
  if (filters.sort) params.set('sort', filters.sort)

  const query = params.toString()
  return query ? `?${query}` : ''
}

export function getBrands(): Promise<{ brands: Brand[] }> {
  return fetchJson('/brands')
}

export function getCategories(): Promise<{ categories: Category[] }> {
  return fetchJson('/categories')
}

export function getProducts(filters: ProductListFilters = {}): Promise<ProductsResponse> {
  return fetchJson(`/products${buildQuery(filters)}`)
}

export function getProduct(slug: string): Promise<ProductDetail> {
  return fetchJson(`/products/${slug}`)
}
