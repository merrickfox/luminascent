import { twMerge } from 'tailwind-merge'

export function cn(...classes: (string | undefined | false | null)[]): string {
  return twMerge(classes.filter(Boolean).join(' '))
}

export function formatPrice(amount: number | null, currency: string | null): string | null {
  if (amount == null) return null
  const code = currency ?? 'GBP'
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100)
}

export function formatSize(size: ProductSizeLike): string | null {
  if (size.size_value != null && size.size_unit) {
    return `${size.size_value}${size.size_unit}`
  }
  if (size.size_grams != null) {
    return `${size.size_grams}g`
  }
  return null
}

type ProductSizeLike = {
  size_value: number | null
  size_unit: string | null
  size_grams: number | null
}

export function groupByFirstLetter<T extends { name: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))

  for (const item of sorted) {
    const letter = item.name.charAt(0).toUpperCase()
    const key = /[A-Z]/.test(letter) ? letter : '#'
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }

  return groups
}

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
