import type { UseFormReturn } from 'react-hook-form'
import type { Accord, Brand, Category, Note, ScentAccordInput, ScentNoteInput } from '@/lib/types'
import { AccordsPicker } from '@/components/accords-picker'
import { ImageUploader, type UploadedImage } from '@/components/image-uploader'
import { NotesPicker } from '@/components/notes-picker'
import { Field } from '@/components/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProductFormValues } from '@/features/products/product-form-schema'
import { SizesEditor } from '@/features/products/sizes-editor'
import type { ProductSizeInput } from '@/lib/types'

type ProductFormFieldsProps = {
  form: UseFormReturn<ProductFormValues>
  categories: Category[]
  brands: Brand[]
  notesCatalog: Note[]
  accordsCatalog: Accord[]
  productId: string
  uploadedImages: UploadedImage[]
  onUploadedImagesChange: (images: UploadedImage[]) => void
  notes: ScentNoteInput[]
  onNotesChange: (notes: ScentNoteInput[]) => void
  accords: ScentAccordInput[]
  onAccordsChange: (accords: ScentAccordInput[]) => void
  sizes: ProductSizeInput[]
  onSizesChange: (sizes: ProductSizeInput[]) => void
  imageHelpText?: string
}

export function ProductFormFields({
  form,
  categories,
  brands,
  notesCatalog,
  accordsCatalog,
  productId,
  uploadedImages,
  onUploadedImagesChange,
  notes,
  onNotesChange,
  accords,
  onAccordsChange,
  sizes,
  onSizesChange,
  imageHelpText,
}: ProductFormFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message}>
          <Input id="name" {...form.register('name')} />
        </Field>
        <Field label="Slug" htmlFor="slug">
          <Input id="slug" placeholder="auto-generated if empty" {...form.register('slug')} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" error={form.formState.errors.category_slug?.message}>
          <Select
            value={form.watch('category_slug')}
            onValueChange={(value) => {
              if (value) form.setValue('category_slug', value, { shouldValidate: true })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.slug}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Brand">
          <Select
            value={form.watch('brand_slug') || 'none'}
            onValueChange={(value) => {
              if (!value) return
              form.setValue('brand_slug', value === 'none' ? '' : value)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.slug}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Description" htmlFor="description">
        <Textarea id="description" rows={3} {...form.register('description')} />
      </Field>

      <Field label="Scent summary" htmlFor="scent_summary">
        <Textarea id="scent_summary" rows={2} {...form.register('scent_summary')} />
      </Field>

      <div>
        {imageHelpText ? (
          <p className="mb-2 text-xs text-muted-foreground">{imageHelpText}</p>
        ) : null}
        <ImageUploader
          productId={productId}
          value={uploadedImages}
          onChange={onUploadedImagesChange}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Release year" htmlFor="release_year">
          <Input id="release_year" type="number" {...form.register('release_year')} />
        </Field>
        <Field label="Wax type" htmlFor="wax_type">
          <Input id="wax_type" {...form.register('wax_type')} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vessel material" htmlFor="vessel_material">
          <Input id="vessel_material" {...form.register('vessel_material')} />
        </Field>
      </div>

      <SizesEditor value={sizes} onChange={onSizesChange} />

      <div className="flex items-center gap-2">
        <Checkbox
          id="is_discontinued"
          checked={form.watch('is_discontinued')}
          onCheckedChange={(checked) => form.setValue('is_discontinued', checked === true)}
        />
        <label htmlFor="is_discontinued" className="text-sm">
          Discontinued
        </label>
      </div>

      <NotesPicker notes={notesCatalog} value={notes} onChange={onNotesChange} />
      <AccordsPicker accords={accordsCatalog} value={accords} onChange={onAccordsChange} />
    </div>
  )
}
