import { useQuery } from '@tanstack/react-query'
import { getCategories } from '../lib/api'
import type { Category } from '../types/api'

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const data = await getCategories()
      return data.categories
    },
  })
}

export function useCategoryMap(categories: Category[] | undefined) {
  if (!categories) return new Map<string, Category>()
  return new Map(categories.map((category) => [category.id, category]))
}
