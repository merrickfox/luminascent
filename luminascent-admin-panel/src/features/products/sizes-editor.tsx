import type { ProductSizeInput } from '@/lib/types'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Plus, Trash2 } from 'lucide-react'

export const emptySizeRow = (): ProductSizeInput => ({
  size_value: undefined,
  size_unit: 'g',
  size_grams: undefined,
  price_amount: undefined,
  price_currency: '',
  burn_time_hours: undefined,
  sku: '',
  availability: '',
  source_url: '',
  is_primary: false,
})

type SizesEditorProps = {
  value: ProductSizeInput[]
  onChange: (sizes: ProductSizeInput[]) => void
}

export function SizesEditor({ value, onChange }: SizesEditorProps) {
  const updateRow = (index: number, patch: Partial<ProductSizeInput>) => {
    const next = value.map((row, i) => (i === index ? { ...row, ...patch } : row))
    if (patch.is_primary) {
      onChange(next.map((row, i) => ({ ...row, is_primary: i === index })))
      return
    }
    onChange(next)
  }

  const removeRow = (index: number) => {
    const next = value.filter((_, i) => i !== index)
    if (next.length > 0 && !next.some((row) => row.is_primary)) {
      next[0] = { ...next[0], is_primary: true }
    }
    onChange(next)
  }

  const addRow = () => {
    const row = emptySizeRow()
    if (value.length === 0) row.is_primary = true
    onChange([...value, row])
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sizes</h3>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus />
          Add size
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sizes yet. Add at least one variant.</p>
      ) : null}

      {value.map((row, index) => (
        <div key={index} className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Size {index + 1}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(index)}>
              <Trash2 />
              Remove
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Value">
              <Input
                type="number"
                value={row.size_value ?? ''}
                onChange={(e) =>
                  updateRow(index, {
                    size_value: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Unit">
              <Input
                value={row.size_unit ?? ''}
                onChange={(e) => updateRow(index, { size_unit: e.target.value || undefined })}
              />
            </Field>
            <Field label="Grams">
              <Input
                type="number"
                value={row.size_grams ?? ''}
                onChange={(e) =>
                  updateRow(index, {
                    size_grams: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Burn time (hrs)">
              <Input
                type="number"
                value={row.burn_time_hours ?? ''}
                onChange={(e) =>
                  updateRow(index, {
                    burn_time_hours: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Price (minor units)">
              <Input
                type="number"
                value={row.price_amount ?? ''}
                onChange={(e) =>
                  updateRow(index, {
                    price_amount: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Currency">
              <Input
                value={row.price_currency ?? ''}
                onChange={(e) => updateRow(index, { price_currency: e.target.value || undefined })}
              />
            </Field>
            <Field label="SKU">
              <Input
                value={row.sku ?? ''}
                onChange={(e) => updateRow(index, { sku: e.target.value || undefined })}
              />
            </Field>
            <Field label="Availability">
              <Input
                value={row.availability ?? ''}
                onChange={(e) => updateRow(index, { availability: e.target.value || undefined })}
              />
            </Field>
          </div>

          <Field label="Source URL">
            <Input
              value={row.source_url ?? ''}
              onChange={(e) => updateRow(index, { source_url: e.target.value || undefined })}
            />
          </Field>

          <div className="flex items-center gap-2">
            <Checkbox
              checked={row.is_primary === true}
              onCheckedChange={(checked) => updateRow(index, { is_primary: checked === true })}
            />
            <span className="text-sm">Primary size</span>
          </div>
        </div>
      ))}
    </div>
  )
}
