import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { ProductSizeInput, ScentAccordInput, ScentNoteInput } from '@/lib/types'
import type { UploadedImage } from '@/components/image-uploader'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { buildProductPayload } from '@/features/products/build-product-payload'
import { ProductFormFields } from '@/features/products/product-form-fields'
import {
  productFormDefaults,
  productFormSchema,
  type ProductFormValues,
} from '@/features/products/product-form-schema'

export function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([])
  const [notes, setNotes] = useState<ScentNoteInput[]>([])
  const [accords, setAccords] = useState<ScentAccordInput[]>([])
  const [sizes, setSizes] = useState<ProductSizeInput[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)

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

  const detailQuery = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.products.get(slug!),
    enabled: Boolean(slug),
  })

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productFormDefaults,
  })

  useEffect(() => {
    const detail = detailQuery.data
    if (!detail) return

    form.reset({
      name: detail.product.name,
      slug: detail.product.slug,
      category_slug: detail.category.slug,
      brand_slug: detail.brand?.slug ?? '',
      release_year: detail.product.release_year ?? undefined,
      description: detail.product.description ?? '',
      wax_type: detail.product.wax_type ?? '',
      vessel_material: detail.product.vessel_material ?? '',
      is_discontinued: detail.product.is_discontinued === 1,
      scent_summary: detail.scent_profile?.summary ?? '',
    })

    setSizes(
      detail.sizes.map((size) => ({
        size_value: size.size_value ?? undefined,
        size_unit: size.size_unit ?? undefined,
        size_grams: size.size_grams ?? undefined,
        price_amount: size.price_amount ?? undefined,
        price_currency: size.price_currency ?? undefined,
        burn_time_hours: size.burn_time_hours ?? undefined,
        sku: size.sku ?? undefined,
        availability: size.availability ?? undefined,
        source_url: size.source_url ?? undefined,
        position: size.position,
        is_primary: size.is_primary === 1,
      })),
    )

    setUploadedImages(
      detail.images.map((image) => ({
        id: image.id,
        r2_key: image.r2_key,
        url: image.url,
        is_primary: image.is_primary,
      })),
    )

    setNotes(
      detail.notes.map((entry) => ({
        note_slug: entry.note.slug,
        pyramid_stage:
          (entry.pyramid_stage as ScentNoteInput['pyramid_stage']) ?? 'general',
        position_index: entry.position_index ?? undefined,
      })),
    )

    setAccords(
      detail.accords.map((entry) => ({
        accord_slug: entry.accord.slug,
        strength_score: entry.strength_score ?? undefined,
        position_index: entry.position_index ?? undefined,
      })),
    )
  }, [detailQuery.data, form])

  const updateMutation = useMutation({
    mutationFn: (values: ProductFormValues) => {
      const productId = detailQuery.data!.product.id
      return api.products.update(
        productId,
        buildProductPayload(values, {
          notes,
          accords,
          uploadedImages,
          sizes,
        }),
      )
    },
    onSuccess: (response) => {
      toast.success('Product updated')
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', slug] })
      if (response.product.slug !== slug) {
        navigate(`/products/${response.product.slug}`, { replace: true })
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.products.delete(detailQuery.data!.product.id),
    onSuccess: () => {
      toast.success('Product deleted')
      queryClient.invalidateQueries({ queryKey: ['products'] })
      navigate('/products')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onSubmit = form.handleSubmit((values) => {
    updateMutation.mutate(values)
  })

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading product...
      </div>
    )
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Button render={<Link to="/products" />} variant="outline" size="sm">
          <ArrowLeft />
          Back to products
        </Button>
        <p className="text-sm text-destructive">
          {(detailQuery.error as Error | undefined)?.message ?? 'Product not found'}
        </p>
      </div>
    )
  }

  const productId = detailQuery.data.product.id

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title={detailQuery.data.product.name}
        description={`Edit product details · ${detailQuery.data.product.slug}`}
        actions={
          <div className="flex items-center gap-2">
            <Button render={<Link to="/products" />} variant="outline">
              <ArrowLeft />
              Back
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              Delete
            </Button>
          </div>
        }
      />

      <form onSubmit={onSubmit} className="space-y-6">
        <ProductFormFields
          form={form}
          categories={categoriesQuery.data?.categories ?? []}
          brands={brandsQuery.data?.brands ?? []}
          notesCatalog={notesQuery.data?.notes ?? []}
          accordsCatalog={accordsQuery.data?.accords ?? []}
          productId={productId}
          uploadedImages={uploadedImages}
          onUploadedImagesChange={setUploadedImages}
          notes={notes}
          onNotesChange={setNotes}
          accords={accords}
          onAccordsChange={setAccords}
          sizes={sizes}
          onSizesChange={setSizes}
          imageHelpText="Upload additional images or remove existing ones, then save to apply."
        />

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product</DialogTitle>
            <DialogDescription>
              This will permanently delete {detailQuery.data.product.name} and its images.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
