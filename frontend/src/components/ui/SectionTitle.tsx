type SectionTitleProps = {
  children: React.ReactNode
  hint?: string
  /** Right-aligned action (e.g. a contribute link). Takes precedence over `hint`. */
  cta?: React.ReactNode
  className?: string
}

/** Display-font section heading with an optional right-aligned meta hint or CTA. */
export function SectionTitle({ children, hint, cta, className }: SectionTitleProps) {
  return (
    <div className={`mb-7 flex items-baseline justify-between gap-4 ${className ?? ''}`}>
      <h2 className="m-0 font-display text-2xl font-normal sm:text-[1.625rem]">{children}</h2>
      {cta ? cta : hint ? <span className="shrink-0 text-xs text-text-secondary">{hint}</span> : null}
    </div>
  )
}
