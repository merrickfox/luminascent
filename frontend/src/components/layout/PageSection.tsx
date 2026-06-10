import { cn } from '../../lib/utils'
import { Container } from './Container'

type PageSectionProps = {
  children: React.ReactNode
  className?: string
  containerClassName?: string
  narrow?: boolean
  id?: string
}

export function PageSection({
  children,
  className,
  containerClassName,
  narrow,
  id,
}: PageSectionProps) {
  return (
    <section id={id} className={cn('py-12 sm:py-16 md:py-24 lg:py-[120px]', className)}>
      <Container className={containerClassName} narrow={narrow}>
        {children}
      </Container>
    </section>
  )
}
