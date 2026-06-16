import type { ProductV2View } from '../../../lib/productViewV2'
import { DataCard } from '../../ui/DataCard'
import { SectionTitle } from '../../ui/SectionTitle'
import { VoteDimension } from './VoteDimension'

type CommunityProfileCardProps = {
  votes: ProductV2View['votes']
  memberCount: number
}

export function CommunityProfileCard({ votes, memberCount }: CommunityProfileCardProps) {
  return (
    <DataCard>
      <SectionTitle hint={memberCount > 0 ? `${memberCount} members` : undefined}>
        Community profile
      </SectionTitle>
      {votes.length > 0 ? (
        <div className="-mt-[1.1rem]">
          {votes.map((d) => (
            <VoteDimension key={d.dimension} dim={d} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">No community votes yet — be the first to weigh in.</p>
      )}
    </DataCard>
  )
}
