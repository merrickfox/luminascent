import { Plus, Trash2 } from 'lucide-react'
import type { Accord, ScentAccordInput } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type AccordsPickerProps = {
  accords: Accord[]
  value: ScentAccordInput[]
  onChange: (value: ScentAccordInput[]) => void
}

export function AccordsPicker({ accords, value, onChange }: AccordsPickerProps) {
  const addRow = () => {
    onChange([
      ...value,
      { accord_slug: accords[0]?.slug ?? '', strength_score: 0.5, position_index: value.length + 1 },
    ])
  }

  const updateRow = (index: number, patch: Partial<ScentAccordInput>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Accords</p>
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={accords.length === 0}>
          <Plus />
          Add accord
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accords added yet.</p>
      ) : (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_100px_80px_auto]">
              <Select
                value={row.accord_slug}
                onValueChange={(accord_slug) => {
                  if (accord_slug) updateRow(index, { accord_slug })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select accord" />
                </SelectTrigger>
                <SelectContent>
                  {accords.map((accord) => (
                    <SelectItem key={accord.id} value={accord.slug}>
                      {accord.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={row.strength_score ?? ''}
                onChange={(event) =>
                  updateRow(index, {
                    strength_score: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
                placeholder="0-1"
              />
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
