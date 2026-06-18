import type {
  DayNightView,
  RatingDistRow,
  ReviewView,
  SeasonBar,
  VoteDimensionView,
} from '../../../lib/productViewV2'

// Decorative-only sample shapes for the "awaiting votes" empty state. These are
// never presented as real data — they render heavily blurred, grayscaled and
// aria-hidden purely as texture behind the invitation.

export const GHOST_VOTES: VoteDimensionView[] = [
  {
    dimension: 'Rating reaction',
    total: 0,
    options: [
      { label: 'Love', pct: 44 },
      { label: 'Like', pct: 33 },
      { label: 'OK', pct: 14 },
      { label: 'Dislike', pct: 6 },
      { label: 'Hate', pct: 3 },
    ],
  },
  {
    dimension: 'Hot throw',
    total: 0,
    options: [
      { label: 'Intimate', pct: 8 },
      { label: 'Moderate', pct: 22 },
      { label: 'Strong', pct: 54 },
      { label: 'Fills the room', pct: 16 },
    ],
  },
  {
    dimension: 'Longevity',
    total: 0,
    options: [
      { label: 'Fleeting', pct: 6 },
      { label: 'Brief', pct: 12 },
      { label: 'Moderate', pct: 28 },
      { label: 'Long-lasting', pct: 41 },
      { label: 'Eternal', pct: 13 },
    ],
  },
  {
    dimension: 'Price value',
    total: 0,
    options: [
      { label: 'Overpriced', pct: 11 },
      { label: 'OK', pct: 22 },
      { label: 'Good Value', pct: 41 },
      { label: 'Great Value', pct: 26 },
    ],
  },
]

export const GHOST_SEASONS: SeasonBar[] = [
  { name: 'Spring', pct: 41 },
  { name: 'Summer', pct: 18 },
  { name: 'Autumn', pct: 86 },
  { name: 'Winter', pct: 72 },
]

export const GHOST_DAY_NIGHT: DayNightView[] = [
  { label: 'Day', pct: 38 },
  { label: 'Night', pct: 62 },
]

export const GHOST_RATING = { avg: 4.4, count: 96 }

export const GHOST_RATING_DIST: RatingDistRow[] = [
  { stars: 5, pct: 68 },
  { stars: 4, pct: 21 },
  { stars: 3, pct: 7 },
  { stars: 2, pct: 3 },
  { stars: 1, pct: 1 },
]

export const GHOST_REVIEWS: ReviewView[] = [
  {
    author: 'Camilla R.',
    rating: 5,
    title: 'Quietly exceptional',
    body: 'The throw fills a large room without ever feeling sweet or synthetic. It stays crisp for hours.',
  },
  {
    author: 'Anonymous',
    rating: 4,
    title: 'Restrained and grown-up',
    body: 'Not a loud candle — which is the point. Burns perfectly even to the edge.',
  },
]
