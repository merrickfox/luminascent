import { Plus, Trash2 } from 'lucide-react'
import type { Note, ScentNoteInput } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const pyramidStages = ['top', 'middle', 'base', 'general', 'unknown'] as const

type NotesPickerProps = {
  notes: Note[]
  value: ScentNoteInput[]
  onChange: (value: ScentNoteInput[]) => void
}

export function NotesPicker({ notes, value, onChange }: NotesPickerProps) {
  const addRow = () => {
    onChange([
      ...value,
      { note_slug: notes[0]?.slug ?? '', pyramid_stage: 'general', position_index: value.length + 1 },
    ])
  }

  const updateRow = (index: number, patch: Partial<ScentNoteInput>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Scent notes</p>
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={notes.length === 0}>
          <Plus />
          Add note
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes added yet.</p>
      ) : (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_140px_80px_auto]">
              <Select
                value={row.note_slug}
                onValueChange={(note_slug) => {
                  if (note_slug) updateRow(index, { note_slug })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select note" />
                </SelectTrigger>
                <SelectContent>
                  {notes.map((note) => (
                    <SelectItem key={note.id} value={note.slug}>
                      {note.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={row.pyramid_stage ?? 'general'}
                onValueChange={(pyramid_stage) => {
                  if (!pyramid_stage) return
                  updateRow(index, {
                    pyramid_stage: pyramid_stage as ScentNoteInput['pyramid_stage'],
                  })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Stage" />
                </SelectTrigger>
                <SelectContent>
                  {pyramidStages.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {stage}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                value={row.position_index ?? ''}
                onChange={(event) =>
                  updateRow(index, {
                    position_index: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
                placeholder="#"
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(index)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
