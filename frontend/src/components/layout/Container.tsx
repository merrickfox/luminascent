import { cn } from '../../lib/utils'

type ContainerProps = {
  children: React.ReactNode
  className?: string
  narrow?: boolean
}

export function Container({ children, className, narrow }: ContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full min-w-0 max-w-full px-5 sm:px-6 md:px-10',
        narrow ? 'max-w-3xl' : 'max-w-6xl',
        className,
      )}
    >
      {children}
    </div>
  )
}
