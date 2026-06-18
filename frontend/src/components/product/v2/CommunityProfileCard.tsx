import { useState } from 'react'
import { buildCommunityDimensions } from '../../../lib/productViewV2'
import type { VoteAggregate, VoteDimensionCatalog } from '../../../types/api'
import { DataCard } from '../../ui/DataCard'
import { SectionTitle } from '../../ui/SectionTitle'
import { ContributeInvite } from './ContributeInvite'
import { ContributeLink } from './ContributeLink'
import { GHOST_VOTES } from './ghostData'
import { VoteDimension } from './VoteDimension'

type CommunityProfileCardProps = {
  /** Raw community vote aggregates from the product detail. */
  votes: VoteAggregate[]
  /** Votable catalog (dimensions + options); undefined while loading. */
  dimensions: VoteDimensionCatalog[] | undefined
  /** The current user's picks, keyed by dimension slug. */
  myVotes: Map<string, string>
  isLoggedIn: boolean
  disabled?: boolean
  onVote: (dimensionSlug: string, optionSlug: string) => void
  onRemove: (dimensionSlug: string) => void
  onRequireLogin: () => void
}

export function CommunityProfileCard({
  votes,
  dimensions,
  myVotes,
  isLoggedIn,
  disabled,
  onVote,
  onRemove,
  onRequireLogin,
}: CommunityProfileCardProps) {
  // When a signed-in user wants to seed the first vote, reveal the live panel.
  const [expanded, setExpanded] = useState(false)

  const rows = buildCommunityDimensions(dimensions, votes)
  const hasVotes = rows.some((d) => d.total > 0)
  const showInteractive = hasVotes || expanded

  const handleSelect = (dimensionSlug: string, optionSlug: string) => {
    if (!isLoggedIn) return onRequireLogin()
    if (myVotes.get(dimensionSlug) === optionSlug) onRemove(dimensionSlug)
    else onVote(dimensionSlug, optionSlug)
  }

  const interactiveRows = (
    <div className="-mt-[1.1rem]">
      {rows.map((d) => (
        <VoteDimension
          key={d.dimensionSlug ?? d.dimension}
          dim={d}
          selected={d.dimensionSlug ? myVotes.get(d.dimensionSlug) : undefined}
          disabled={disabled}
          onSelect={(optionSlug) => handleSelect(d.dimensionSlug!, optionSlug)}
        />
      ))}
    </div>
  )

  return (
    <DataCard>
      <SectionTitle
        hint={
          !showInteractive ? 'No votes yet' : isLoggedIn ? 'Tap an option to vote' : undefined
        }
        cta={
          showInteractive && !isLoggedIn ? (
            <ContributeLink label="Log in to vote" onClick={onRequireLogin} />
          ) : undefined
        }
      >
        Community profile
      </SectionTitle>

      {showInteractive ? (
        interactiveRows
      ) : (
        <ContributeInvite
          title="How does it perform?"
          body="Share how this candle throws, burns, and lasts. Your vote builds the profile."
          ctaLabel={isLoggedIn ? 'Be the first to vote' : 'Log in to vote'}
          onCta={isLoggedIn ? () => setExpanded(true) : onRequireLogin}
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
