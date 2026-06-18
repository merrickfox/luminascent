import { ADMIN_API_KEY } from '@/lib/config'
import type {
  Accord,
  AdminReview,
  ApiError,
  Brand,
  Category,
  CreateAccordInput,
  CreateBrandInput,
  CreateCategoryInput,
  CreateNoteInput,
  CreateProductInput,
  EnsureBrandInput,
  EnsureBrandResult,
  ImportOptions,
  ImportProductRecord,
  ImportProductResult,
  Note,
  Product,
  ProductDetail,
  ProductListFilters,
  ReviewCounts,
  ReviewListFilters,
  UpdateColorInput,
  UpdateProductInput,
  UserReviewProfile,
} from '@/lib/types'

let apiHost = 'http://localhost:8023'

export function setApiHost(host: string) {
  apiHost = host
}

export function getApiHost() {
  return apiHost
}

export class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiHost}/admin${path}`
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ADMIN_API_KEY,
      ...init?.headers,
    },
  })

  const body = (await response.json().catch(() => ({}))) as T & ApiError

  if (!response.ok) {
    throw new ApiRequestError(body.error ?? response.statusText, response.status)
  }

  return body
}

async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const url = `${apiHost}/admin${path}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': ADMIN_API_KEY,
    },
    body: formData,
  })

  const body = (await response.json().catch(() => ({}))) as T & ApiError

  if (!response.ok) {
    throw new ApiRequestError(body.error ?? response.statusText, response.status)
  }

  return body
}

function toQueryString(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value))
    }
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const api = {
  brands: {
    list: () => apiFetch<{ brands: Brand[] }>('/brands'),
    create: (input: CreateBrandInput) =>
      apiFetch<{ brand: Brand }>('/brands', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
  categories: {
    list: () => apiFetch<{ categories: Category[] }>('/categories'),
    create: (input: CreateCategoryInput) =>
      apiFetch<{ category: Category }>('/categories', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
  notes: {
    list: () => apiFetch<{ notes: Note[] }>('/notes'),
    create: (input: CreateNoteInput) =>
      apiFetch<{ note: Note }>('/notes', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateColor: (id: string, input: UpdateColorInput) =>
      apiFetch<{ note: Note }>(`/notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
  },
  accords: {
    list: () => apiFetch<{ accords: Accord[] }>('/accords'),
    create: (input: CreateAccordInput) =>
      apiFetch<{ accord: Accord }>('/accords', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateColor: (id: string, input: UpdateColorInput) =>
      apiFetch<{ accord: Accord }>(`/accords/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
  },
  products: {
    list: (filters: ProductListFilters = {}) =>
      apiFetch<{ products: Product[]; filters: ProductListFilters }>(
        `/products${toQueryString({
          category: filters.category,
          brand: filters.brand,
          notes: filters.notes?.join(','),
          accords: filters.accords?.join(','),
          vote_options: filters.vote_options?.join(','),
          min_rating: filters.min_rating,
          limit: filters.limit,
          offset: filters.offset,
          sort: filters.sort,
        })}`,
      ),
    create: (input: CreateProductInput) =>
      apiFetch<{ product: Product }>('/products', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    get: (slug: string) => apiFetch<ProductDetail>(`/products/${slug}`),
    update: (id: string, input: UpdateProductInput) =>
      apiFetch<{ product: Product }>(`/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    delete: (id: string) =>
      apiFetch<{ ok: boolean }>(`/products/${id}`, {
        method: 'DELETE',
      }),
    bulkDelete: (ids: string[]) =>
      apiFetch<{ deleted: string[]; notFound: string[] }>('/products/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    uploadImage: (productId: string, file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return apiUpload<{ id: string; r2_key: string; url: string }>(
        `/products/${productId}/images`,
        formData,
      )
    },
    deleteImage: (productId: string, r2Key: string) =>
      apiFetch<{ ok: boolean }>(`/products/${productId}/images/draft`, {
        method: 'DELETE',
        body: JSON.stringify({ r2_key: r2Key }),
      }),
  },
  reviews: {
    list: (filters: ReviewListFilters = {}) =>
      apiFetch<{ reviews: AdminReview[]; counts: ReviewCounts }>(
        `/reviews${toQueryString({
          status: filters.status,
          product_id: filters.product_id,
          user_id: filters.user_id,
          limit: filters.limit,
          offset: filters.offset,
        })}`,
      ),
    get: (id: string) => apiFetch<{ review: AdminReview }>(`/reviews/${id}`),
    approve: (id: string, note?: string) =>
      apiFetch<{ review: AdminReview }>(`/reviews/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    reject: (id: string, note?: string) =>
      apiFetch<{ review: AdminReview }>(`/reviews/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    userProfile: (userId: string) => apiFetch<UserReviewProfile>(`/reviews/user/${userId}`),
  },
  import: {
    ensureBrand: (input: EnsureBrandInput) =>
      apiFetch<EnsureBrandResult>('/import/brand', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    importProduct: (product: ImportProductRecord, options?: ImportOptions) =>
      apiFetch<{ result: ImportProductResult }>('/import/product', {
        method: 'POST',
        body: JSON.stringify({ product, options }),
      }),
  },
}
