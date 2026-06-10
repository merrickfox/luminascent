import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FieldProps = {
  label: string
  htmlFor?: string
  error?: string
  children: ReactNode
  className?: string
}

export function Field({ label, htmlFor, error, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
