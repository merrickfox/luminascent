import { Plus } from 'lucide-react'

type ContributeLinkProps = {
  label?: string
  onClick?: () => void
}

/** Inline "contribute" link shown beside a populated voting card's title.
 *  Voting submission isn't wired yet — this is a visual CTA for now. */
export function ContributeLink({ label = 'Add your vote', onClick }: ContributeLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium uppercase tracking-[0.08em] text-accent transition-colors duration-200 hover:text-text"
    >
      <Plus className="h-[13px] w-[13px]" />
      {label}
    </button>
  )
}
