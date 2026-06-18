import type {
  Brand,
  Category,
  MyVote,
  ProductDetail,
  ProductListFilters,
  ProductsResponse,
  User,
  VoteAggregate,
  VoteDimensionCatalog,
} from '../types/api'
import { supabase } from './supabase'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8023'

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Attach the current Supabase access token as a Bearer header. */
  auth?: boolean
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false } = options
  const headers: Record<string, string> = {}

  if (body !== undefined) headers['content-type'] = 'application/json'

  if (auth) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message = typeof errorBody.error === 'string' ? errorBody.error : response.statusText
    throw new Error(message || `Request failed (${response.status})`)
  }

  return response.json() as Promise<T>
}

function fetchJson<T>(path: string): Promise<T> {
  return apiRequest<T>(path)
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

// --- Users (authenticated) ---

/** Current user's registry row. Requires a Supabase session. */
export function getMe(): Promise<{ user: User }> {
  return apiRequest('/me', { auth: true })
}

/**
 * Create (or refresh) the current user's registry row. Idempotent — call after
 * sign-up (with the chosen username) and after sign-in (no username needed).
 */
export function ensureMe(username?: string): Promise<{ user: User }> {
  return apiRequest('/me', { method: 'POST', auth: true, body: username ? { username } : {} })
}

export function updateMe(username: string): Promise<{ user: User }> {
  return apiRequest('/me', { method: 'PATCH', auth: true, body: { username } })
}

// --- Community votes ---

type VoteResult = { votes: VoteAggregate[]; my_votes: MyVote[] }

/** The full votable catalog (dimensions + options). Public. */
export function getVoteDimensions(): Promise<{ dimensions: VoteDimensionCatalog[] }> {
  return apiRequest('/vote-dimensions')
}

/** The current user's votes for a product. Requires a session. */
export function getMyVotes(productId: string): Promise<{ my_votes: MyVote[] }> {
  return apiRequest(`/products/${productId}/my-votes`, { auth: true })
}

export function castVote(productId: string, dimensionSlug: string, optionSlug: string): Promise<VoteResult> {
  return apiRequest(`/products/${productId}/vote`, {
    method: 'POST',
    auth: true,
    body: { dimension_slug: dimensionSlug, option_slug: optionSlug },
  })
}

export function removeVote(productId: string, dimensionSlug: string): Promise<VoteResult> {
  return apiRequest(`/products/${productId}/vote`, {
    method: 'DELETE',
    auth: true,
    body: { dimension_slug: dimensionSlug },
  })
}
