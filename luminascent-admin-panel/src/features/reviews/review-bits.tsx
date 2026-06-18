import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ReviewStatus } from '@/lib/types'

const STATUS_VARIANT: Record<ReviewStatus, 'default' | 'secondary' | 'destructive'> = {
  approved: 'default',
  pending: 'secondary',
  rejected: 'destructive',
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <Badge variant={STATUS_VARIANT[status]} className="capitalize">{status}</Badge>
}

/** Read-only star rating display. */
export function Stars({ rating, className }: { rating: number | null; className?: string }) {
  if (rating == null) return <span className="text-xs text-muted-foreground">No rating</span>
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} title={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('size-3.5', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')}
        />
      ))}
    </span>
  )
}

/** SQLite timestamps are 'YYYY-MM-DD HH:MM:SS' in UTC. */
export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}
