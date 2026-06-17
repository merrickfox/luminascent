import type { ProductDetail, VoteAggregate } from '../types/api'
import { resolveEntityColor } from './colors'
import { formatPrice, formatSize } from './utils'

// View model for the data-driven Product page V2. Each field is either backed
// by real API data or carries an explicit `null` so components can render a
// placeholder state — we never fabricate values.

export type PyramidGroup = { stage: string; notes: { name: string; color: string }[] }
/** pct is null when the community strength score is unknown. */
export type AccordBar = { name: string; color: string; pct: number | null }
export type AccordChip = { name: string; color: string }
export type VoteOptionView = { label: string; pct: number }
export type VoteDimensionView = { dimension: string; total: number; options: VoteOptionView[] }
export type SeasonBar = { name: string; pct: number }
export type DayNightView = { label: 'Day' | 'Night'; pct: number }
/** lowercase => render the value with a CSS lowercase transform (for unit-bearing cells). */
export type SpecCell = { label: string; value: string | null; lowercase?: boolean }
export type StockistView = { name: string; kind: string; price: string | null; url: string | null }
export type SimilarView = { name: string; brand: string | null; tone: string; match: number | null; url: string | null }
export type ReviewView = { author: string; rating: number | null; title: string | null; body: string }
export type RatingDistRow = { stars: number; pct: number }

export type ProductV2View = {
  name: string
  brand: string | null
  brandSlug: string | null
  brandCountry: string | null
  scentType: string | null
  year: number | null
  perfumer: string | null
  fromPrice: string | null
  summary: string | null
  rating: { avg: number | null; count: number }
  pyramid: PyramidGroup[]
  accords: AccordBar[]
  accordChips: AccordChip[]
  votes: VoteDimensionView[]
  seasons: SeasonBar[]
  dayNight: DayNightView[]
  specs: SpecCell[]
  stockists: StockistView[]
  similar: SimilarView[]
  reviews: ReviewView[]
  /** null => no per-star distribution available (placeholder). */
  ratingDist: RatingDistRow[] | null
}

const TONES = ['olive', 'espresso', 'oxblood', 'stone', 'taupe']

const STAGE_LABELS: Record<string, string> = {
  top: 'Top',
  middle: 'Heart',
  heart: 'Heart',
  base: 'Base',
}
const STAGE_ORDER = ['Top', 'Heart', 'Base', 'Other']

const SEASON_ORDER: Array<{ slug: string; name: string }> = [
  { slug: 'spring', name: 'Spring' },
  { slug: 'summer', name: 'Summer' },
  { slug: 'autumn', name: 'Autumn' },
  { slug: 'winter', name: 'Winter' },
]

function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

function groupNotesByStage(detail: ProductDetail): PyramidGroup[] {
  const buckets = new Map<string, { name: string; color: string }[]>()
  for (const entry of detail.notes) {
    const stage = STAGE_LABELS[(entry.pyramid_stage ?? '').toLowerCase()] ?? 'Other'
    const list = buckets.get(stage) ?? []
    list.push({ name: entry.note.name, color: entry.note.color_gradient ?? resolveEntityColor(entry.note) })
    buckets.set(stage, list)
  }
  return STAGE_ORDER.filter((stage) => buckets.has(stage)).map((stage) => ({
    stage,
    notes: buckets.get(stage)!,
  }))
}

function groupVotesByDimension(votes: VoteAggregate[]): VoteDimensionView[] {
  const order: string[] = []
  const byDimension = new Map<string, VoteAggregate[]>()
  for (const vote of votes) {
    // Season and time-of-day get their own dedicated sections.
    if (vote.dimension_slug === 'season' || vote.dimension_slug === 'time_of_day') continue
    if (!byDimension.has(vote.dimension_slug)) {
      byDimension.set(vote.dimension_slug, [])
      order.push(vote.dimension_slug)
    }
    byDimension.get(vote.dimension_slug)!.push(vote)
  }
  return order.map((slug) => {
    const rows = byDimension.get(slug)!
    const total = rows.reduce((sum, r) => sum + r.vote_count, 0)
    return {
      dimension: rows[0].dimension_name,
      total,
      options: rows.map((r) => ({ label: r.option_label, pct: pct(r.vote_count, total) })),
    }
  })
}

function buildSeasons(votes: VoteAggregate[]): SeasonBar[] {
  const season = votes.filter((v) => v.dimension_slug === 'season')
  if (season.length === 0) return []
  const total = season.reduce((sum, v) => sum + v.vote_count, 0)
  return SEASON_ORDER.map(({ slug, name }) => {
    const row = season.find((v) => v.option_slug === slug)
    return { name, pct: row ? pct(row.vote_count, total) : 0 }
  })
}

function buildDayNight(votes: VoteAggregate[]): DayNightView[] {
  const tod = votes.filter((v) => v.dimension_slug === 'time_of_day')
  if (tod.length === 0) return []
  const total = tod.reduce((sum, v) => sum + v.vote_count, 0)
  const sumOf = (slugs: string[]) =>
    tod.filter((v) => slugs.includes(v.option_slug)).reduce((sum, v) => sum + v.vote_count, 0)
  return [
    { label: 'Day', pct: pct(sumOf(['morning', 'day']), total) },
    { label: 'Night', pct: pct(sumOf(['evening', 'night']), total) },
  ]
}

function stockistFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const name = host.split('.')[0]
    return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    return 'Stockist'
  }
}

export function toProductV2View(detail: ProductDetail): ProductV2View {
  const { product, brand, scent_profile, accords, sizes, votes, rating, reviews, reminds } = detail

  const primarySize = sizes.find((s) => s.is_primary) ?? sizes[0] ?? null

  const pricedSizes = sizes.filter((s) => s.price_amount != null)
  const cheapest =
    pricedSizes.length > 0
      ? pricedSizes.reduce((min, s) => (s.price_amount! < min.price_amount! ? s : min))
      : null
  const fromPrice = cheapest ? formatPrice(cheapest.price_amount, cheapest.price_currency) : null

  const scentType =
    accords.length > 0
      ? accords.slice(0, 2).map((a) => a.accord.name).join(' · ')
      : null

  const accordBars: AccordBar[] = accords
    .map((a) => ({
      name: a.accord.name,
      color: resolveEntityColor(a.accord),
      pct: a.strength_score != null ? Math.round(a.strength_score * 100) : null,
    }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))

  const accordChips: AccordChip[] = accords
    .slice(0, 5)
    .map((a) => ({ name: a.accord.name, color: resolveEntityColor(a.accord) }))

  // Stockists: the house first (if it has a site), then any size with a source URL.
  const stockists: StockistView[] = []
  if (brand?.website_url) {
    stockists.push({ name: brand.name, kind: 'The house', price: fromPrice, url: brand.website_url })
  }
  const seenUrls = new Set(stockists.map((s) => s.url))
  for (const size of sizes) {
    if (!size.source_url || seenUrls.has(size.source_url)) continue
    seenUrls.add(size.source_url)
    stockists.push({
      name: stockistFromUrl(size.source_url),
      kind: 'Stockist',
      price: formatPrice(size.price_amount, size.price_currency),
      url: size.source_url,
    })
  }

  const specs: SpecCell[] = [
    { label: 'Burn time', value: primarySize?.burn_time_hours != null ? `${primarySize.burn_time_hours} hrs` : null },
    { label: 'Wax weight', value: primarySize ? formatSize(primarySize) : null, lowercase: true },
    { label: 'Dimensions', value: null },
    { label: 'Wax type', value: product.wax_type },
    { label: 'Vessel', value: product.vessel_material },
    { label: 'Wick', value: null },
    { label: 'Released', value: product.release_year != null ? String(product.release_year) : null },
    { label: 'Made in', value: brand?.country ?? null },
  ]

  const similar: SimilarView[] = reminds.slice(0, 4).map((r, i) => ({
    name: r.external_product_name ?? 'Linked candle',
    brand: r.external_brand_name,
    tone: TONES[i % TONES.length],
    match: null,
    url: r.external_source_url,
  }))

  const reviewViews: ReviewView[] = reviews.slice(0, 6).map((r) => ({
    author: r.author_name ?? 'Anonymous',
    rating: r.rating,
    title: r.title,
    body: r.body,
  }))

  return {
    name: product.name,
    brand: brand?.name ?? null,
    brandSlug: brand?.slug ?? null,
    brandCountry: brand?.country ?? null,
    scentType,
    year: product.release_year,
    perfumer: null,
    fromPrice,
    summary: scent_profile?.summary ?? product.description ?? null,
    rating: { avg: rating?.rating_avg ?? null, count: rating?.rating_count ?? 0 },
    pyramid: groupNotesByStage(detail),
    accords: accordBars,
    accordChips,
    votes: groupVotesByDimension(votes),
    seasons: buildSeasons(votes),
    dayNight: buildDayNight(votes),
    specs,
    stockists,
    similar,
    reviews: reviewViews,
    ratingDist: null,
  }
}
