import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSubmitReview } from '../../hooks/useReviews'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { StarRating } from '../ui/StarRating'
import { Textarea } from '../ui/Textarea'

type ReviewFormModalProps = {
  open: boolean
  onClose: () => void
  productId: string | undefined
  productName: string
}

export function ReviewFormModal({ open, onClose, productId, productName }: ReviewFormModalProps) {
  const submit = useSubmitReview(productId)
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Reset everything each time the modal opens.
  useEffect(() => {
    if (open) {
      setRating(0)
      setTitle('')
      setBody('')
      setError(null)
      setSubmitted(false)
      submit.reset()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (rating < 1) {
      setError('Please choose a star rating.')
      return
    }
    if (body.trim().length === 0) {
      setError('Please write your review.')
      return
    }
    try {
      await submit.mutateAsync({ rating, title: title.trim() || undefined, body: body.trim() })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Write a review"
    >
      <div className="absolute inset-0 bg-text/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-[var(--radius-card)] border border-border bg-bg p-6 shadow-xl sm:p-8">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 text-text-secondary transition-colors hover:text-text"
        >
          <X size={18} strokeWidth={1.5} />
        </button>

        {submitted ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
              <Check size={22} strokeWidth={2} />
            </span>
            <h2 className="font-display text-2xl font-medium text-text">Thank you</h2>
            <p className="max-w-[320px] text-sm leading-relaxed text-text-secondary">
              Your review has been submitted and will appear once it&apos;s approved by a moderator.
            </p>
            <Button onClick={onClose} className="mt-2 w-full">
              Done
            </Button>
          </div>
        ) : (
          <>
            <h2 className="font-display text-2xl font-medium text-text">Write a review</h2>
            <p className="mt-1 text-sm text-text-secondary">{productName}</p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-text-secondary">
                  Your rating
                </span>
                <StarRating value={rating} onChange={setRating} />
              </div>

              <Input
                name="title"
                label="Title (optional)"
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sum it up in a few words"
              />

              <Textarea
                name="body"
                label="Your review"
                value={body}
                maxLength={5000}
                onChange={(e) => setBody(e.target.value)}
                placeholder="How does it throw, burn, and last?"
              />

              <p className="text-xs text-text-secondary">
                Reviews are moderated before they appear publicly.
              </p>

              {error && <p className="text-sm text-error">{error}</p>}

              <Button type="submit" disabled={submit.isPending} className="w-full">
                {submit.isPending ? 'Submitting…' : 'Submit review'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
