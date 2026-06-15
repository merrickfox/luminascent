import { cn } from '../../lib/utils'

export type ContainerSize = 'content' | 'narrow' | 'hero'

type ContainerProps = {
  children: React.ReactNode
  className?: string
  size?: ContainerSize
  /** @deprecated Use `size="narrow"` instead */
  narrow?: boolean
}

const sizeClasses: Record<ContainerSize, string> = {
  content: 'max-w-[var(--container-content)]',
  narrow: 'max-w-[var(--container-narrow)]',
  hero: 'max-w-[var(--container-hero)]',
}

const paddingClasses = 'px-5 sm:px-6 md:px-8 lg:px-10'

export function Container({ children, className, size, narrow }: ContainerProps) {
  const resolvedSize = size ?? (narrow ? 'narrow' : 'content')

  return (
    <div
      className={cn(
        'mx-auto w-full min-w-0',
        paddingClasses,
        sizeClasses[resolvedSize],
        className,
      )}
    >
      {children}
    </div>
  )
}
