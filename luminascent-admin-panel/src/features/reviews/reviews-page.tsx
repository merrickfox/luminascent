import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { api } from '@/lib/api'
import type { AdminReview, ReviewStatus } from '@/lib/types'
import { PageHeader } from '@/components/page-header'
import { LoadingTable } from '@/components/loading-table'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ReviewModerationDialog } from './review-moderation-dialog'
import { UserReviewsSheet } from './user-reviews-sheet'
import { ReviewStatusBadge, Stars, formatDateTime } from './review-bits'

type Filter = ReviewStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

function excerpt(body: string, max = 80) {
  return body.length > max ? `${body.slice(0, max).trimEnd()}…` : body
}

export function ReviewsPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('pending')
  const [selected, setSelected] = useState<AdminReview | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-reviews', filter],
    queryFn: () => api.reviews.list({ status: filter === 'all' ? undefined : filter }),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-reviews'] })
    queryClient.invalidateQueries({ queryKey: ['admin-user-reviews'] })
  }

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => api.reviews.approve(id, note),
    onSuccess: () => {
      toast.success('Review approved')
      setSelected(null)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => api.reviews.reject(id, note),
    onSuccess: () => {
      toast.success('Review rejected')
      setSelected(null)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const pending = approveMutation.isPending || rejectMutation.isPending
  const counts = data?.counts

  return (
    <div className="space-y-6">
      <PageHeader title="User reviews" description="Moderate member-submitted reviews." />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? undefined : counts?.[f.key]
          return (
            <Button
              key={f.key}
              variant={filter === f.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {count != null ? <span className="ml-1.5 text-xs opacity-70">{count}</span> : null}
            </Button>
          )
        })}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <LoadingTable columns={6} />
      ) : data && data.reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews in this view.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Reviewer</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.reviews.map((review) => (
              <TableRow key={review.id}>
                <TableCell className="font-medium">{review.product_name}</TableCell>
                <TableCell>
                  {review.user_id ? (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setUserId(review.user_id)}
                    >
                      {review.user_username ?? review.author_name ?? 'Unknown'}
                    </button>
                  ) : (
                    (review.author_name ?? 'Unknown')
                  )}
                </TableCell>
                <TableCell>
                  <Stars rating={review.rating} />
                </TableCell>
                <TableCell className="max-w-xs">
                  {review.title ? <span className="font-medium">{review.title} · </span> : null}
                  <span className="text-muted-foreground">{excerpt(review.body)}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(review.created_at)}
                </TableCell>
                <TableCell>
                  <ReviewStatusBadge status={review.status} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(review)}>
                      View
                    </Button>
                    {review.status !== 'approved' ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Approve"
                        disabled={pending}
                        onClick={() => approveMutation.mutate({ id: review.id })}
                      >
                        <Check />
                      </Button>
                    ) : null}
                    {review.status !== 'rejected' ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Reject"
                        disabled={pending}
                        onClick={() => rejectMutation.mutate({ id: review.id })}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ReviewModerationDialog
        review={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onApprove={(note) => selected && approveMutation.mutate({ id: selected.id, note })}
        onReject={(note) => selected && rejectMutation.mutate({ id: selected.id, note })}
        pending={pending}
      />

      <UserReviewsSheet userId={userId} onOpenChange={(open) => !open && setUserId(null)} />
    </div>
  )
}
