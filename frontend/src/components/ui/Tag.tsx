import type { CSSProperties } from 'react'
import { cn } from '../../lib/utils'

type TagVariant = 'soft' | 'outline' | 'solid'

type TagProps = {
  children: React.ReactNode
  variant?: TagVariant
  /** Tints the outline ring (e.g. an accord's family colour). */
  color?: string
  className?: string
}

const variantClasses: Record<TagVariant, string> = {
  soft: 'border border-border bg-transparent text-text',
  outline: 'border-2 bg-transparent text-text',
  solid: 'border border-text bg-text text-bg',
}

export function Tag({ children, variant = 'soft', color, className }: TagProps) {
  const style: CSSProperties | undefined =
    variant === 'outline' && color ? { borderColor: color } : undefined

  return (
    <span
      style={style}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm leading-tight',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
