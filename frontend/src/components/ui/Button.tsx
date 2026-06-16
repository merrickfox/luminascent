import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

type ButtonVariant = 'primary' | 'secondary'

type ButtonProps = {
  children: React.ReactNode
  variant?: ButtonVariant
  className?: string
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  iconOnly?: boolean
  'aria-label'?: string
}

type ButtonLinkProps = {
  children: React.ReactNode
  to: string
  variant?: ButtonVariant
  className?: string
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-text text-bg border border-text hover:bg-espresso hover:border-espresso',
  secondary:
    'bg-transparent text-text border border-border hover:border-text-secondary',
}

const baseClasses =
  'inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-button)] text-sm tracking-wide transition-all duration-300 ease-out'

export function Button({
  children,
  variant = 'primary',
  className,
  type = 'button',
  onClick,
  disabled,
  iconOnly,
  'aria-label': ariaLabel,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        baseClasses,
        iconOnly ? 'w-12 px-0' : 'px-6',
        variantClasses[variant],
        disabled && 'opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function ButtonLink({ children, to, variant = 'primary', className }: ButtonLinkProps) {
  return (
    <Link to={to} className={cn(baseClasses, 'px-6', variantClasses[variant], className)}>
      {children}
    </Link>
  )
}
