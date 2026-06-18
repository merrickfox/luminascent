import { useState } from 'react'
import type { ProductV2View } from '../../../lib/productViewV2'
import { DataCard } from '../../ui/DataCard'
import { SectionTitle } from '../../ui/SectionTitle'
import { ContributeInvite } from './ContributeInvite'
import { ContributeLink } from './ContributeLink'
import { GHOST_DAY_NIGHT, GHOST_SEASONS } from './ghostData'
import { SeasonBars } from './SeasonBars'

type SeasonalityCardProps = {
  seasons: ProductV2View['seasons']
  dayNight: ProductV2View['dayNight']
  /** The current user's picks, keyed by dimension slug. */
  myVotes: Map<string, string>
  isLoggedIn: boolean
  disabled?: boolean
  onVote: (dimensionSlug: string, optionSlug: string) => void
  onRemove: (dimensionSlug: string) => void
  onRequireLogin: () => void
}

const DAY_SLUGS = ['morning', 'day']

export function SeasonalityCard({
  seasons,
  dayNight,
  myVotes,
  isLoggedIn,
  disabled,
  onVote,
  onRemove,
  onRequireLogin,
}: SeasonalityCardProps) {
  const [expanded, setExpanded] = useState(false)

  const hasVotes =
    seasons.some((s) => (s.count ?? 0) > 0) || dayNight.some((d) => (d.count ?? 0) > 0)
  const showInteractive = hasVotes || expanded

  const selectedSeason = myVotes.get('season')
  const timeSlug = myVotes.get('time_of_day')
  const selectedDayNight = timeSlug
    ? DAY_SLUGS.includes(timeSlug)
      ? ('Day' as const)
      : ('Night' as const)
    : undefined

  const handleSeason = (optionSlug: string) => {
    if (!isLoggedIn) return onRequireLogin()
    if (selectedSeason === optionSlug) onRemove('season')
    else onVote('season', optionSlug)
  }

  const handleDayNight = (label: 'Day' | 'Night', optionSlug: string) => {
    if (!isLoggedIn) return onRequireLogin()
    if (selectedDayNight === label) onRemove('time_of_day')
    else onVote('time_of_day', optionSlug)
  }

  return (
    <DataCard>
      <SectionTitle
        hint={
          !showInteractive ? 'No votes yet' : isLoggedIn ? 'Tap to vote' : 'When members burn it'
        }
        cta={
          showInteractive && !isLoggedIn ? (
            <ContributeLink label="Log in to vote" onClick={onRequireLogin} />
          ) : undefined
        }
      >
        Seasonality
      </SectionTitle>

      {showInteractive ? (
        <div>
          {isLoggedIn && (
            <p className="-mt-3 mb-5 text-xs leading-relaxed text-text-secondary">
              Tap a season and a Day/Night you'd burn this in. Tap a highlighted pick to remove it.
            </p>
          )}
          <SeasonBars
            seasons={seasons}
            dayNight={dayNight}
            selectedSeason={selectedSeason}
            selectedDayNight={selectedDayNight}
            disabled={disabled}
            onSeasonSelect={handleSeason}
            onDayNightSelect={handleDayNight}
          />
        </div>
      ) : (
        <ContributeInvite
          title="When do you reach for it?"
          body="Tell us the seasons and time of day this candle suits best."
          ctaLabel={isLoggedIn ? 'Be the first to vote' : 'Log in to vote'}
          onCta={isLoggedIn ? () => setExpanded(true) : onRequireLogin}
          ghost={<SeasonBars seasons={GHOST_SEASONS} dayNight={GHOST_DAY_NIGHT} />}
        />
      )}
    </DataCard>
  )
}
