import { Button } from '../../ui/Button'

type ContributeInviteProps = {
  /** Decorative chart/content markup rendered as a faint, blurred backdrop. */
  ghost: React.ReactNode
  eyebrow?: string
  title: string
  body: string
  ctaLabel?: string
  /** Minimum body height so sibling empty cards line up. */
  minHeight?: number
}

// Denser behind the headline for legibility, fading at the edges so the ghost
// content reads through — the shared "awaiting data" scrim.
const scrim =
  'radial-gradient(115% 85% at 50% 50%, color-mix(in srgb, var(--color-surface) 82%, transparent) 32%, color-mix(in srgb, var(--color-surface) 32%, transparent) 100%)'

/** Empty-data invitation floated over abstract ghost content. Used wherever a
 *  product is awaiting community contributions (votes, seasonality, reviews).
 *  Submission UIs aren't wired yet — the button is a visual CTA for now. */
export function ContributeInvite({
  ghost,
  eyebrow = 'Awaiting votes',
  title,
  body,
  ctaLabel = 'Be the first to vote',
  minHeight = 300,
}: ContributeInviteProps) {
  return (
    <div className="relative" style={{ minHeight }}>
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
          {eyebrow}
        </span>
        <p className="m-0 max-w-[320px] font-display text-[1.625rem] font-normal leading-tight text-text">
          {title}
        </p>
        <p className="mx-0 mb-7 mt-3 max-w-[300px] text-sm leading-relaxed text-text-secondary">
          {body}
        </p>
        <Button variant="primary">{ctaLabel}</Button>
      </div>
    </div>
  )
}
