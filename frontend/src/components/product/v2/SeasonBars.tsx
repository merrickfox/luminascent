import { Moon, Sun } from 'lucide-react'
import type { DayNightView, SeasonBar } from '../../../lib/productViewV2'

type SeasonBarsProps = {
  seasons: SeasonBar[]
  dayNight: DayNightView[]
}

/** Vertical season columns + a Day/Night split. */
export function SeasonBars({ seasons, dayNight }: SeasonBarsProps) {
  const max = Math.max(1, ...seasons.map((s) => s.pct))

  return (
    <div>
      <div className="flex h-[120px] items-end gap-3">
        {seasons.map((s) => (
          <div key={s.name} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className="text-xs tabular-nums text-text-secondary">{s.pct}</span>
            <div
              className="w-full max-w-[56px] rounded-t"
              style={{
                height: `${(s.pct / max) * 88}px`,
                background: s.pct === max ? 'var(--color-accent)' : 'var(--color-stone)',
              }}
            />
            <span className="text-xs uppercase tracking-[0.06em] text-text-secondary">{s.name}</span>
          </div>
        ))}
      </div>

      {dayNight.length > 0 ? (
        <div className="mt-6 flex gap-3">
          {dayNight.map((d) => (
            <div
              key={d.label}
              className="flex flex-1 items-center justify-between rounded-[var(--radius-button)] border border-border px-4 py-3"
            >
              <span className="inline-flex items-center gap-2 text-sm">
                {d.label === 'Day' ? (
                  <Sun className="h-4 w-4 text-text-secondary" />
                ) : (
                  <Moon className="h-4 w-4 text-text-secondary" />
                )}
                {d.label}
              </span>
              <span className="font-display text-lg">{d.pct}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
