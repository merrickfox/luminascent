import { cn } from '../../lib/utils'

type EmptyStateProps = {
  title: string
  description?: string
  className?: string
}

export function EmptyState({ title, description, className }: EmptyStateProps) {
  return (
    <div className={cn('py-16 text-center', className)}>
      <h3 className="font-display text-2xl text-text">{title}</h3>
      {description ? (
        <p className="mx-auto mt-3 max-w-md text-text-secondary">{description}</p>
      ) : null}
    </div>
  )
}
