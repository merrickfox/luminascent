import { cn } from '../../lib/utils'

type LabelProps = {
  children: React.ReactNode
  className?: string
}

export function Label({ children, className }: LabelProps) {
  return (
    <span
      className={cn(
        'text-xs font-medium uppercase tracking-[0.08em] text-text-secondary',
        className,
      )}
    >
      {children}
    </span>
  )
}
