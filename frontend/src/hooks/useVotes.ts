import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { castVote, getMyVotes, getVoteDimensions, removeVote } from '../lib/api'
import type { MyVote, ProductDetail } from '../types/api'

/** The votable catalog (dimensions + options). Effectively static. */
export function useVoteDimensions() {
  return useQuery({
    queryKey: ['vote-dimensions'],
    queryFn: async () => (await getVoteDimensions()).dimensions,
    staleTime: Infinity,
  })
}

/** The current user's votes for a product. Only runs when signed in. */
export function useMyVotes(productId: string | undefined) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['my-votes', productId],
    queryFn: async () => (await getMyVotes(productId!)).my_votes,
    enabled: Boolean(session && productId),
  })
}

/**
 * Cast/change and remove a vote, writing the server's fresh aggregates +
 * my-votes straight into the cache (the endpoints return both, so no refetch).
 */
export function useVoteMutations(slug: string | undefined, productId: string | undefined) {
  const queryClient = useQueryClient()

  const apply = (votes: ProductDetail['votes'], myVotes: MyVote[]) => {
    if (slug) {
      queryClient.setQueryData<ProductDetail>(['product', slug], (prev) =>
        prev ? { ...prev, votes } : prev,
      )
    }
    queryClient.setQueryData(['my-votes', productId], myVotes)
  }

  const cast = useMutation({
    mutationFn: ({ dimensionSlug, optionSlug }: { dimensionSlug: string; optionSlug: string }) =>
      castVote(productId!, dimensionSlug, optionSlug),
    onSuccess: ({ votes, my_votes }) => apply(votes, my_votes),
  })

  const remove = useMutation({
    mutationFn: (dimensionSlug: string) => removeVote(productId!, dimensionSlug),
    onSuccess: ({ votes, my_votes }) => apply(votes, my_votes),
  })

  return { cast, remove, isPending: cast.isPending || remove.isPending }
}
