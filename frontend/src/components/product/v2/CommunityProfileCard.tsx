import type { ProductV2View } from '../../../lib/productViewV2'
import { DataCard } from '../../ui/DataCard'
import { SectionTitle } from '../../ui/SectionTitle'
import { ContributeInvite } from './ContributeInvite'
import { ContributeLink } from './ContributeLink'
import { GHOST_VOTES } from './ghostData'
import { VoteDimension } from './VoteDimension'

type CommunityProfileCardProps = {
  votes: ProductV2View['votes']
}

export function CommunityProfileCard({ votes }: CommunityProfileCardProps) {
  const hasVotes = votes.length > 0

  return (
    <DataCard>
      <SectionTitle
        hint={hasVotes ? undefined : 'No votes yet'}
        cta={hasVotes ? <ContributeLink label="Add your vote" /> : undefined}
      >
        Community profile
      </SectionTitle>

      {hasVotes ? (
        <div className="-mt-[1.1rem]">
          {votes.map((d) => (
            <VoteDimension key={d.dimension} dim={d} />
          ))}
        </div>
      ) : (
        <ContributeInvite
          title="How does it perform?"
          body="Share how this candle throws, burns, and lasts. Your vote builds the profile."
          ghost={
            <div className="-mt-[1.1rem]">
              {GHOST_VOTES.map((d) => (
                <VoteDimension key={d.dimension} dim={d} />
              ))}
            </div>
          }
        />
      )}
    </DataCard>
  )
}
