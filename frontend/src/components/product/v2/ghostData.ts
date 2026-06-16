import type { DayNightView, SeasonBar, VoteDimensionView } from '../../../lib/productViewV2'

// Decorative-only sample shapes for the "awaiting votes" empty state. These are
// never presented as real data — they render heavily blurred, grayscaled and
// aria-hidden purely as texture behind the invitation.

export const GHOST_VOTES: VoteDimensionView[] = [
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
      { label: 'Tunnels', pct: 6 },
      { label: 'Good', pct: 31 },
      { label: 'Excellent', pct: 63 },
    ],
  },
  {
    dimension: 'Value',
    total: 0,
    options: [
      { label: 'Overpriced', pct: 11 },
      { label: 'Fair', pct: 38 },
      { label: 'Worth it', pct: 51 },
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
