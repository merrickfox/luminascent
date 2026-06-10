import { cn } from '../../lib/utils'

type CardProps = {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'article'
}

export function Card({ children, className, as: Component = 'div' }: CardProps) {
  return (
    <Component
      className={cn(
        'rounded-[var(--radius-card)] border border-border bg-surface transition-all duration-300 ease-out',
        className,
      )}
    >
      {children}
    </Component>
  )
}
