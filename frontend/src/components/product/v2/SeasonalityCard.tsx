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
}

export function SeasonalityCard({ seasons, dayNight }: SeasonalityCardProps) {
  const hasVotes = seasons.length > 0

  return (
    <DataCard>
      <SectionTitle
        hint={hasVotes ? 'When members burn it' : 'No votes yet'}
        cta={hasVotes ? <ContributeLink label="Add yours" /> : undefined}
      >
        Seasonality
      </SectionTitle>

      {hasVotes ? (
        <SeasonBars seasons={seasons} dayNight={dayNight} />
      ) : (
        <ContributeInvite
          title="When do you reach for it?"
          body="Tell us the seasons and time of day this candle suits best."
          ghost={<SeasonBars seasons={GHOST_SEASONS} dayNight={GHOST_DAY_NIGHT} />}
        />
      )}
    </DataCard>
  )
}
