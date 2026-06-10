import { cn } from '../../lib/utils'

type EyebrowProps = {
  children: React.ReactNode
  className?: string
}

export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <p
      className={cn(
        'mb-4 text-xs font-medium uppercase tracking-[0.12em] text-accent',
        className,
      )}
    >
      {children}
    </p>
  )
}
