import { cn } from '../../lib/utils'
import { Container, type ContainerSize } from './Container'

type PageSectionProps = {
  children: React.ReactNode
  className?: string
  containerClassName?: string
  containerSize?: ContainerSize
  /** @deprecated Use `containerSize="narrow"` instead */
  narrow?: boolean
  id?: string
}

export function PageSection({
  children,
  className,
  containerClassName,
  containerSize,
  narrow,
  id,
}: PageSectionProps) {
  const resolvedSize = containerSize ?? (narrow ? 'narrow' : 'content')

  return (
    <section id={id} className={cn('py-12 sm:py-16 md:py-24 lg:py-[120px]', className)}>
      <Container className={containerClassName} size={resolvedSize}>
        {children}
      </Container>
    </section>
  )
}
