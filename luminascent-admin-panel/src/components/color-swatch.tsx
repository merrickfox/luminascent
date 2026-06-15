import type { CSSProperties } from 'react'

type ColorSwatchProps = {
  color: string | null
  colorGradient?: string | null
  className?: string
}

export function ColorSwatch({ color, colorGradient, className = '' }: ColorSwatchProps) {
  if (!color && !colorGradient) {
    return <span className={`inline-block h-6 w-6 rounded-full border border-border bg-muted ${className}`} />
  }

  const style: CSSProperties = colorGradient
    ? { background: colorGradient }
    : { backgroundColor: color ?? undefined }

  return (
    <span
      className={`inline-block h-6 w-6 shrink-0 rounded-full border border-border/60 ${className}`}
      style={style}
      title={colorGradient ?? color ?? undefined}
    />
  )
}
