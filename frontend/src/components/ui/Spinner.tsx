import { cn } from '../../lib/utils'

type SpinnerProps = {
  className?: string
  label?: string
}

export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center py-24', className)} role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
