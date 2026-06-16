type NoteSwatchProps = {
  name: string
  color?: string
}

/** A scent note: a coloured disc (its scent-family colour) + the note name. */
export function NoteSwatch({ name, color }: NoteSwatchProps) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden
        className="h-8 w-8 shrink-0 rounded-full border border-border"
        style={{ background: color ?? 'var(--color-stone)' }}
      />
      <span className="text-sm text-text">{name}</span>
    </span>
  )
}
