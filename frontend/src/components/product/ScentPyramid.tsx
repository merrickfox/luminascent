import type { ScentProfileNote } from '../../types/api'
import { Label } from '../ui/Label'

type ScentPyramidProps = {
  notes: ScentProfileNote[]
}

const STAGES: { key: string; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Heart' },
  { key: 'base', label: 'Base' },
  { key: 'general', label: 'General' },
]

export function ScentPyramid({ notes }: ScentPyramidProps) {
  if (notes.length === 0) return null

  const byStage: { key: string; label: string; items: ScentProfileNote[] }[] = STAGES.map(
    (stage) => ({
      ...stage,
      items: notes.filter((item) => (item.pyramid_stage ?? 'general') === stage.key),
    }),
  ).filter((stage) => stage.items.length > 0)

  const uncategorized = notes.filter(
    (item) =>
      !STAGES.some((stage) => (item.pyramid_stage ?? 'general') === stage.key),
  )

  if (uncategorized.length > 0) {
    byStage.push({
      key: 'unknown',
      label: 'Notes',
      items: uncategorized,
    })
  }

  return (
    <div className="space-y-8">
      {byStage.map((stage) => (
        <div key={stage.key}>
          <Label className="mb-3 block">{stage.label}</Label>
          <div className="flex flex-wrap gap-2">
            {stage.items.map((item) => (
              <span
                key={`${stage.key}-${item.note.slug}`}
                className="max-w-full break-words rounded-full border border-border px-3 py-1.5 text-sm text-text sm:px-4 sm:py-2"
              >
                {item.note.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
