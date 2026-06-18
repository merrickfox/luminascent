import { Check, Moon, Sun } from 'lucide-react'
import type { DayNightView, SeasonBar } from '../../../lib/productViewV2'
import { cn } from '../../../lib/utils'

type SeasonBarsProps = {
  seasons: SeasonBar[]
  dayNight: DayNightView[]
  /** The season option slug the current user picked, if any. */
  selectedSeason?: string
  /** The user's current Day/Night side, if any. */
  selectedDayNight?: 'Day' | 'Night'
  /** When provided, seasons/boxes become clickable vote controls. */
  onSeasonSelect?: (optionSlug: string) => void
  onDayNightSelect?: (label: 'Day' | 'Night', optionSlug: string) => void
  disabled?: boolean
}

/** Vertical season columns + a Day/Night split. Read-only unless select
 *  handlers are provided. */
export function SeasonBars({
  seasons,
  dayNight,
  selectedSeason,
  selectedDayNight,
  onSeasonSelect,
  onDayNightSelect,
  disabled,
}: SeasonBarsProps) {
  const max = Math.max(1, ...seasons.map((s) => s.pct))
  const seasonInteractive = Boolean(onSeasonSelect)
  const dayNightInteractive = Boolean(onDayNightSelect)

  return (
    <div>
      <div className="flex h-[120px] items-end gap-3">
        {seasons.map((s) => {
          const isSelected = s.optionSlug != null && s.optionSlug === selectedSeason
          const column = (
            <>
              <span className="text-xs tabular-nums text-text-secondary">{s.pct}</span>
              <div
                className="w-full max-w-[48px] rounded-t"
                style={{
                  height: `${(s.pct / max) * 80}px`,
                  background: s.pct === max && s.pct > 0 ? 'var(--color-accent)' : 'var(--color-stone)',
                }}
              />
              <span
                className={cn(
                  'flex items-center gap-1 text-xs uppercase tracking-[0.06em]',
                  isSelected ? 'font-medium text-accent' : 'text-text-secondary',
                )}
              >
                {isSelected && <Check className="h-3 w-3" strokeWidth={2.5} />}
                {s.name}
              </span>
            </>
          )

          if (seasonInteractive && s.optionSlug) {
            return (
              <button
                key={s.name}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                title={isSelected ? `Remove your ${s.name} vote` : `Vote ${s.name}`}
                onClick={() => onSeasonSelect?.(s.optionSlug!)}
                className={cn(
                  'flex h-full flex-1 cursor-pointer flex-col items-center justify-end gap-2 rounded-lg border px-1 pb-2 pt-1.5 transition-colors',
                  isSelected
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-text-secondary hover:bg-surface',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                {column}
              </button>
            )
          }

          return (
            <div key={s.name} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              {column}
            </div>
          )
        })}
      </div>

      {dayNight.length > 0 ? (
        <div className="mt-6 flex gap-3">
          {dayNight.map((d) => {
            const isSelected = selectedDayNight === d.label
            const inner = (
              <>
                <span className="inline-flex items-center gap-2 text-sm">
                  {d.label === 'Day' ? (
                    <Sun className={cn('h-4 w-4', isSelected ? 'text-accent' : 'text-text-secondary')} />
                  ) : (
                    <Moon className={cn('h-4 w-4', isSelected ? 'text-accent' : 'text-text-secondary')} />
                  )}
                  {d.label}
                  {isSelected && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />}
                </span>
                <span className="font-display text-lg">{d.pct}%</span>
              </>
            )
            const boxClass =
              'flex flex-1 items-center justify-between rounded-[var(--radius-button)] border px-4 py-3'

            if (dayNightInteractive && d.optionSlug) {
              return (
                <button
                  key={d.label}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() => onDayNightSelect?.(d.label, d.optionSlug!)}
                  className={cn(
                    boxClass,
                    'text-left transition-colors',
                    isSelected ? 'border-accent bg-accent/10' : 'border-border hover:border-text-secondary',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {inner}
                </button>
              )
            }

            return (
              <div key={d.label} className={cn(boxClass, 'border-border')}>
                {inner}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
