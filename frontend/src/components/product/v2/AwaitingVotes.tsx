import { Button } from '../../ui/Button'

type AwaitingVotesProps = {
  /** Decorative chart markup rendered as a faint, blurred backdrop. */
  ghost: React.ReactNode
  title: string
  body: string
}

// Denser behind the headline for legibility, fading at the edges so the ghost
// bars read through — mirrors the design's radial scrim.
const scrim =
  'radial-gradient(115% 85% at 50% 50%, color-mix(in srgb, var(--color-surface) 82%, transparent) 32%, color-mix(in srgb, var(--color-surface) 32%, transparent) 100%)'

/** No-vote empty state: an invitation floated over abstract ghost data.
 *  Voting submission isn't wired yet — the button is a visual CTA for now. */
export function AwaitingVotes({ ghost, title, body }: AwaitingVotesProps) {
  return (
    <div className="relative min-h-[300px]">
      <div
        aria-hidden
        className="select-none"
        style={{ filter: 'blur(3px) grayscale(0.15)', opacity: 0.62, pointerEvents: 'none' }}
      >
        {ghost}
      </div>

      <div
        className="absolute inset-0 z-[2] flex flex-col items-center justify-center px-8 text-center"
        style={{ background: scrim }}
      >
        <span className="mb-3.5 text-xs font-medium uppercase tracking-[0.12em] text-accent">
          Awaiting votes
        </span>
        <p className="m-0 max-w-[320px] font-display text-[1.625rem] font-normal leading-tight text-text">
          {title}
        </p>
        <p className="mx-0 mb-7 mt-3 max-w-[300px] text-sm leading-relaxed text-text-secondary">
          {body}
        </p>
        <Button variant="primary">Be the first to vote</Button>
      </div>
    </div>
  )
}
