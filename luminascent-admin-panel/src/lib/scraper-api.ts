// Client for the local scraper server (:8777) — the bridge backend for the Scraper
// section. Separate from lib/api.ts (the Cloudflare Worker on :8023): no /admin prefix,
// no x-api-key, CORS is open, and it only works when the local server is running.
import { SCRAPER_HOST } from '@/lib/config'

export class ScraperApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ScraperApiError'
    this.status = status
  }
}

async function scraperFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${SCRAPER_HOST}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    // Connection refused / server down — surface a typed offline error.
    throw new ScraperApiError('Scraper server is not reachable', 0)
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw new ScraperApiError(body.error ?? response.statusText, response.status)
  }
  return body
}

// --- Response shapes (mirror server/admin-api.mjs) ---

export type SiteSummary = {
  folder: string
  host: string | null
  brandName: string | null
  brandSlug: string | null
  productCount: number
  hasBrowse: boolean
  fieldCount: number
  imageRuleCount: number
  hasProductsJson: boolean
  updatedAt: string | null
}

export type ProductFlag =
  | 'no-name'
  | 'no-images'
  | 'no-price'
  | 'no-notes-accords'
  | 'llm-errors'

export type SiteProduct = {
  slug: string
  sourceUrl: string | null
  name: string | null
  hasData: boolean
  hasLlmInput: boolean
  hasLlmOutput: boolean
  inProductsJson: boolean
  imageCount: number
  primaryImage: string | null
  hasDom: boolean
  flags: ProductFlag[]
}

export type ScraperConfig = {
  host?: string
  brand?: { name?: string; slug?: string } | null
  browse?: unknown
  product?: { fields?: Array<{ fieldKey: string; scope?: string; type?: string }> }
  images?: unknown[]
  updatedAt?: string
}

export type SiteDetail = {
  folder: string
  config: ScraperConfig
  hasProductsJson: boolean
  productsJsonCount: number
  products: SiteProduct[]
}

export type CapturedData = {
  source_url?: string
  fields?: Record<string, string | string[]>
  images?: Array<{ source_url: string; position?: number; is_primary?: boolean }>
}

export type AssembledProduct = {
  name?: string
  slug?: string
  description?: string
  scent_summary?: string
  sizes?: Array<Record<string, unknown>>
  notes?: Array<{ name?: string; pyramid_stage?: string }>
  accords?: Array<{ name?: string }>
  images?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type ProductBundle = {
  folder: string
  slug: string
  data: CapturedData | null
  llmInput: Record<string, unknown> | null
  llmOutput: { fields?: Record<string, unknown>; errors?: string[]; processedAt?: string } | null
  product: AssembledProduct | null
  images: string[]
  domFile: string | null
}

export type RecipePreview = {
  available: boolean
  reason?: string
  fields?: Record<string, { value: string | string[] | null; resolved: boolean; locatorCount: number }>
  images?: Array<{ order: number; resolvedUrl: string | null; resolved: boolean }>
}

export type WorklistStatus = 'not-started' | 'configured' | 'captured' | 'assembled'

export type WorklistBrand = {
  name: string
  annotation: string | null
  status: WorklistStatus
  folder: string | null
  productCount: number | null
  hasProductsJson: boolean | null
}

export type Worklist = { available: boolean; brands: WorklistBrand[] }

export type PipelineCommand = 'run' | 'push' | 'sync'

export type Job = {
  id: string
  command: PipelineCommand
  folder: string
  flags: string[]
  status: 'running' | 'done' | 'failed'
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  log: string[]
}

export const scraperApi = {
  health: () => scraperFetch<{ ok: boolean; port: number }>('/health'),
  sites: {
    list: () => scraperFetch<{ sites: SiteSummary[] }>('/sites'),
    get: (folder: string) => scraperFetch<SiteDetail>(`/sites/${encodeURIComponent(folder)}`),
  },
  products: {
    get: (folder: string, slug: string) =>
      scraperFetch<ProductBundle>(
        `/sites/${encodeURIComponent(folder)}/products/${encodeURIComponent(slug)}`,
      ),
  },
  worklist: () => scraperFetch<Worklist>('/worklist'),
  recipePreview: (folder: string, slug: string) =>
    scraperFetch<RecipePreview>('/recipe/preview', {
      method: 'POST',
      body: JSON.stringify({ host: folder, slug }),
    }),
  pipeline: {
    start: (command: PipelineCommand, folder: string, flags: string[]) =>
      scraperFetch<{ job?: Job; error?: string; jobId?: string }>(
        `/pipeline/${command}`,
        { method: 'POST', body: JSON.stringify({ host: folder, flags }) },
      ),
  },
  jobs: {
    get: (id: string) => scraperFetch<{ job: Job }>(`/jobs/${encodeURIComponent(id)}`),
    list: () => scraperFetch<{ jobs: Job[] }>('/jobs'),
  },
}

// Direct URLs for <img>/<iframe> (served as bytes/html, not JSON).
export function productImageUrl(folder: string, slug: string, file: string) {
  return `${SCRAPER_HOST}/sites/${encodeURIComponent(folder)}/products/${encodeURIComponent(slug)}/images/${encodeURIComponent(file)}`
}

export function productDomUrl(folder: string, slug: string) {
  return `${SCRAPER_HOST}/sites/${encodeURIComponent(folder)}/products/${encodeURIComponent(slug)}/dom`
}
