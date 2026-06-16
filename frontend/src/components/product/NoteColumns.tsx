import type { ScentProfileAccord, ScentProfileNote } from '../../types/api'
import { outlineColorStyle, swatchBackgroundStyle } from '../../lib/colors'
import { Label } from '../ui/Label'

type NoteColumnsProps = {
  notes: ScentProfileNote[]
  accords: ScentProfileAccord[]
  scentType?: string | null
}

const PYRAMID_STAGES = [
  { key: 'top', label: 'Top notes' },
  { key: 'middle', label: 'Middle notes' },
  { key: 'base', label: 'Base notes' },
] as const

type PyramidStageKey = (typeof PYRAMID_STAGES)[number]['key']

const PYRAMID_STAGE_KEYS = new Set<string>(PYRAMID_STAGES.map((stage) => stage.key))

function isPyramidStaged(stage: string | null): stage is PyramidStageKey {
  return stage !== null && PYRAMID_STAGE_KEYS.has(stage)
}

function sortByPosition(notes: ScentProfileNote[]) {
  return [...notes].sort((a, b) => (a.position_index ?? 0) - (b.position_index ?? 0))
}

function NoteSwatch({ note }: { note: ScentProfileNote['note'] }) {
  return (
    <div
      className="h-8 w-8 shrink-0 rounded-full border border-border/60"
      style={swatchBackgroundStyle(note)}
      aria-hidden
    />
  )
}

function NoteItem({ note }: { note: ScentProfileNote }) {
  return (
    <div className="inline-flex items-center gap-2.5">
      <NoteSwatch note={note.note} />
      <span className="text-sm leading-none text-text">{note.note.name}</span>
    </div>
  )
}

function NoteList({ notes }: { notes: ScentProfileNote[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      {notes.map((item) => (
        <NoteItem key={item.note.slug} note={item} />
      ))}
    </div>
  )
}

export function NoteColumns({ notes, accords, scentType }: NoteColumnsProps) {
  const stagedNotes = notes.filter((item) => isPyramidStaged(item.pyramid_stage))
  const unstagedNotes = sortByPosition(notes.filter((item) => !isPyramidStaged(item.pyramid_stage)))

  const stagesWithNotes = PYRAMID_STAGES.map((stage) => ({
    ...stage,
    items: sortByPosition(stagedNotes.filter((item) => item.pyramid_stage === stage.key)),
  })).filter((stage) => stage.items.length > 0)

  const sortedAccords = [...accords].sort(
    (a, b) => (a.position_index ?? 0) - (b.position_index ?? 0),
  )

  if (
    stagesWithNotes.length === 0 &&
    unstagedNotes.length === 0 &&
    sortedAccords.length === 0 &&
    !scentType
  ) {
    return null
  }

  return (
    <div className="space-y-8">
      <div>
        <Label className="mb-2 block">Scent profile</Label>
        {scentType ? (
          <p className="font-display text-xl italic text-text-secondary">{scentType}</p>
        ) : null}
      </div>

      {stagesWithNotes.length > 0 ? (
        <table className="w-full border-collapse">
          <tbody>
            {stagesWithNotes.map((stage, index) => (
              <tr
                key={stage.key}
                className={index > 0 ? 'border-t border-border/70' : undefined}
              >
                <th
                  scope="row"
                  className="w-[7.5rem] py-4 pr-6 align-top text-left sm:w-32"
                >
                  <Label>{stage.label}</Label>
                </th>
                <td className="py-4 align-top">
                  <NoteList notes={stage.items} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {unstagedNotes.length > 0 ? (
        <div>
          <Label className="mb-3 block">Notes</Label>
          <NoteList notes={unstagedNotes} />
        </div>
      ) : null}

      {sortedAccords.length > 0 ? (
        <div>
          <Label className="mb-3 block">Accords</Label>
          <div className="flex flex-wrap gap-2">
            {sortedAccords.map((item) => (
              <span
                key={item.accord.slug}
                className="rounded-full border-2 bg-transparent px-4 py-1.5 text-sm text-text"
                style={outlineColorStyle(item.accord)}
              >
                {item.accord.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
