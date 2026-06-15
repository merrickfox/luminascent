import type { CSSProperties } from 'react'

const FAMILY_COLORS: Record<string, string> = {
  citrus: '#e8c547',
  floral: '#d4a0b8',
  woody: '#8b7355',
  green: '#7a9e6e',
  spicy: '#c47a4a',
  fruity: '#d97a6a',
  aquatic: '#6ba3c4',
  aromatic: '#8fa87a',
  gourmand: '#b8956a',
  earthy: '#7d6b5a',
  musk: '#a89f94',
  amber: '#c9a06c',
}

const DEFAULT_COLOR = '#d5cbbf'

export type ColorFields = {
  color?: string | null
  color_gradient?: string | null
  note_family?: string | null
}

export function getFamilyColor(noteFamily: string | null): string {
  if (!noteFamily) return DEFAULT_COLOR
  const key = noteFamily.toLowerCase()
  for (const [family, color] of Object.entries(FAMILY_COLORS)) {
    if (key.includes(family)) return color
  }
  return DEFAULT_COLOR
}

export function resolveEntityColor(entity: ColorFields): string {
  if (entity.color) return entity.color
  return getFamilyColor(entity.note_family ?? null)
}

export function swatchBackgroundStyle(entity: ColorFields): CSSProperties {
  if (entity.color_gradient) {
    return { background: entity.color_gradient }
  }
  const color = resolveEntityColor(entity)
  return { backgroundColor: color }
}

export function outlineColorStyle(entity: ColorFields): CSSProperties {
  const color = resolveEntityColor(entity)
  return { borderColor: color }
}
