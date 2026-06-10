import { useQuery } from '@tanstack/react-query'
import { getProducts } from '../lib/api'
import type { ProductListFilters } from '../types/api'

export function useProducts(filters: ProductListFilters = {}) {
  return useQuery({
    queryKey: ['products', filters],
    queryFn: () => getProducts(filters),
  })
}
