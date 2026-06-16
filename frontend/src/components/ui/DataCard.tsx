import { cn } from '../../lib/utils'

type DataCardProps = {
  children: React.ReactNode
  className?: string
  /** Drop the default padding (e.g. for a full-bleed grid inside). */
  flush?: boolean
}

/** Surface card with a hairline border — the data-panel container for V2. */
export function DataCard({ children, className, flush }: DataCardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-border bg-surface',
        flush ? 'overflow-hidden' : 'p-6 sm:p-8',
        className,
      )}
    >
      {children}
    </div>
  )
}
