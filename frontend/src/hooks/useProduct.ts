import { useQuery } from '@tanstack/react-query'
import { getProduct } from '../lib/api'

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ['product', slug],
    queryFn: () => getProduct(slug!),
    enabled: Boolean(slug),
  })
}
