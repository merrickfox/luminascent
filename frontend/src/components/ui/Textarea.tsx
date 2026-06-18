import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, className, id, ...props },
  ref,
) {
  const textareaId = id ?? props.name
  return (
    <label htmlFor={textareaId} className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-text-secondary">
          {label}
        </span>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        className={cn(
          'min-h-[120px] resize-y rounded-[var(--radius-button)] border border-border bg-surface px-3 py-2.5 text-sm text-text',
          'outline-none transition-colors duration-200 placeholder:text-text-secondary/60',
          'focus:border-text-secondary',
          className,
        )}
        {...props}
      />
    </label>
  )
})
