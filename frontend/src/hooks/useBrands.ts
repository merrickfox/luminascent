import { useQuery } from '@tanstack/react-query'
import { getBrands } from '../lib/api'
import type { Brand } from '../types/api'

export function useBrands() {
  return useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const data = await getBrands()
      return data.brands
    },
  })
}

export function useBrand(slug: string | undefined) {
  const query = useBrands()

  const brand = slug
    ? query.data?.find((item) => item.slug === slug) ?? null
    : null

  return {
    ...query,
    brand,
  }
}

export function useBrandMap(brands: Brand[] | undefined) {
  if (!brands) return new Map<string, Brand>()
  return new Map(brands.map((brand) => [brand.id, brand]))
}
