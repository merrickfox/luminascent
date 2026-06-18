import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, className, id, ...props },
  ref,
) {
  const inputId = id ?? props.name
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-text-secondary">
          {label}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'h-11 rounded-[var(--radius-button)] border border-border bg-surface px-3 text-sm text-text',
          'outline-none transition-colors duration-200 placeholder:text-text-secondary/60',
          'focus:border-text-secondary',
          className,
        )}
        {...props}
      />
    </label>
  )
})
