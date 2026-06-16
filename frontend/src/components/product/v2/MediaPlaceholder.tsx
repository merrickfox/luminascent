type Tone = 'stone' | 'taupe' | 'olive' | 'espresso' | 'oxblood'

const TONE_STYLES: Record<Tone, { bg: string; ink: string }> = {
  stone: { bg: '#d5cbbf', ink: '#6b6258' },
  taupe: { bg: '#a28e7d', ink: '#f7f4ee' },
  olive: { bg: '#4a5444', ink: '#e7e0d7' },
  espresso: { bg: '#352b26', ink: '#d8cfc2' },
  oxblood: { bg: '#5d2e2e', ink: '#e7d6cf' },
}

type MediaPlaceholderProps = {
  name?: string
  tone?: string
  ratio?: string
}

/** Warm, framed editorial ground with a Canela monogram — stands in for
 *  product photography when no real image exists. Ported from the design. */
export function MediaPlaceholder({ name = '', tone = 'stone', ratio = '1 / 1' }: MediaPlaceholderProps) {
  const t = TONE_STYLES[(tone as Tone)] ?? TONE_STYLES.stone
  const initial = (name.trim()[0] || 'L').toUpperCase()
  return (
    <div
      className="flex w-full items-center justify-center overflow-hidden"
      style={{ aspectRatio: ratio, background: t.bg }}
    >
      <span
        className="select-none font-display font-light leading-none"
        style={{ color: t.ink, opacity: 0.85, fontSize: 'clamp(48px, 14vw, 96px)' }}
      >
        {initial}
      </span>
    </div>
  )
}
