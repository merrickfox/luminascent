import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { ProductSizeInput, ScentAccordInput, ScentNoteInput } from '@/lib/types'
import type { UploadedImage } from '@/components/image-uploader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { buildProductPayload } from '@/features/products/build-product-payload'
import { ProductFormFields } from '@/features/products/product-form-fields'
import {
  productFormDefaults,
  productFormSchema,
  type ProductFormValues,
} from '@/features/products/product-form-schema'

export function CreateProductDialog() {
  const [open, setOpen] = useState(false)
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([])
  const [notes, setNotes] = useState<ScentNoteInput[]>([])
  const [accords, setAccords] = useState<ScentAccordInput[]>([])
  const [sizes, setSizes] = useState<ProductSizeInput[]>([])
  const queryClient = useQueryClient()

  const resetDraft = () => {
    setDraftId(crypto.randomUUID())
    setUploadedImages([])
    setNotes([])
    setAccords([])
    setSizes([])
  }

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
  })
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.brands.list(),
  })
  const notesQuery = useQuery({
    queryKey: ['notes'],
    queryFn: () => api.notes.list(),
  })
  const accordsQuery = useQuery({
    queryKey: ['accords'],
    queryFn: () => api.accords.list(),
  })

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productFormDefaults,
  })

  const createMutation = useMutation({
    mutationFn: api.products.create,
    onSuccess: () => {
      toast.success('Product created')
      queryClient.invalidateQueries({ queryKey: ['products'] })
      form.reset(productFormDefaults)
      resetDraft()
      setOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onSubmit = form.handleSubmit((values) => {
    createMutation.mutate(
      buildProductPayload(values, {
        id: draftId,
        notes,
        accords,
        uploadedImages,
        sizes,
      }),
    )
  })

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      form.reset(productFormDefaults)
      resetDraft()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <Plus />
        New product
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create product</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <ProductFormFields
            form={form}
            categories={categoriesQuery.data?.categories ?? []}
            brands={brandsQuery.data?.brands ?? []}
            notesCatalog={notesQuery.data?.notes ?? []}
            accordsCatalog={accordsQuery.data?.accords ?? []}
            productId={draftId}
            uploadedImages={uploadedImages}
            onUploadedImagesChange={setUploadedImages}
            notes={notes}
            onNotesChange={setNotes}
            accords={accords}
            onAccordsChange={setAccords}
            sizes={sizes}
            onSizesChange={setSizes}
            imageHelpText="Upload before saving. Images are stored under the draft product id."
          />
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create product'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
