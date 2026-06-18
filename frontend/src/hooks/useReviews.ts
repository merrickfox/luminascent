import { useMutation } from '@tanstack/react-query'
import { submitReview } from '../lib/api'

/**
 * Submit a review for a product. The created review is pending moderation, so
 * there's nothing to write into the product cache — the caller shows a
 * confirmation message instead.
 */
export function useSubmitReview(productId: string | undefined) {
  return useMutation({
    mutationFn: (input: { rating: number; title?: string; body: string }) =>
      submitReview(productId!, input),
  })
}
