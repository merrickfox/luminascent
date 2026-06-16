import type { ProductV2View } from '../../../lib/productViewV2'
import { DataCard } from '../../ui/DataCard'
import { SectionTitle } from '../../ui/SectionTitle'
import { SeasonBars } from './SeasonBars'

type SeasonalityCardProps = {
  seasons: ProductV2View['seasons']
  dayNight: ProductV2View['dayNight']
}

export function SeasonalityCard({ seasons, dayNight }: SeasonalityCardProps) {
  return (
    <DataCard>
      <SectionTitle hint="When members burn it">Seasonality</SectionTitle>
      {seasons.length > 0 ? (
        <SeasonBars seasons={seasons} dayNight={dayNight} />
      ) : (
        <p className="text-sm text-text-secondary">Not enough seasonal votes yet.</p>
      )}
    </DataCard>
  )
}
