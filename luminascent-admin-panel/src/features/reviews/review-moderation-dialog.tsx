import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ReviewStatusBadge, Stars, formatDateTime } from './review-bits'
import type { AdminReview } from '@/lib/types'

type Props = {
  review: AdminReview | null
  onOpenChange: (open: boolean) => void
  onApprove: (note?: string) => void
  onReject: (note?: string) => void
  pending: boolean
}

export function ReviewModerationDialog({ review, onOpenChange, onApprove, onReject, pending }: Props) {
  const [note, setNote] = useState('')

  useEffect(() => {
    setNote(review?.moderation_note ?? '')
  }, [review])

  return (
    <Dialog open={review != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {review ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                Review
                <ReviewStatusBadge status={review.status} />
              </DialogTitle>
              <DialogDescription>
                {review.product_name} · submitted {formatDateTime(review.created_at)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{review.user_username ?? review.author_name ?? 'Unknown'}</p>
                  <p className="text-muted-foreground">{review.user_email ?? '—'}</p>
                </div>
                <Stars rating={review.rating} />
              </div>

              {review.title ? <p className="font-medium">{review.title}</p> : null}
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{review.body}</p>

              {review.moderated_at ? (
                <p className="text-xs text-muted-foreground">
                  Last moderated {formatDateTime(review.moderated_at)}
                </p>
              ) : null}

              <div className="space-y-2">
                <label htmlFor="mod-note" className="text-xs font-medium text-muted-foreground">
                  Moderation note (optional)
                </label>
                <Textarea
                  id="mod-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Internal note / reason"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                disabled={pending || review.status === 'rejected'}
                onClick={() => onReject(note.trim() || undefined)}
              >
                <X />
                Reject
              </Button>
              <Button
                disabled={pending || review.status === 'approved'}
                onClick={() => onApprove(note.trim() || undefined)}
              >
                <Check />
                Approve
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
