import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Brand } from '@/lib/types'
import { PageHeader } from '@/components/page-header'
import { LoadingTable } from '@/components/loading-table'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const brandFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
  country: z.string().optional(),
  website_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})

type BrandForm = z.infer<typeof brandFormSchema>

const emptyForm: BrandForm = { name: '', slug: '', country: '', website_url: '' }

export function BrandsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Brand | null>(null)
  const [deleting, setDeleting] = useState<Brand | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.brands.list(),
  })

  const form = useForm<BrandForm>({
    resolver: zodResolver(brandFormSchema),
    defaultValues: emptyForm,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['brands'] })

  const createMutation = useMutation({
    mutationFn: api.brands.create,
    onSuccess: () => {
      toast.success('Brand created')
      invalidate()
      setDialogOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: BrandForm }) =>
      api.brands.update(id, {
        name: input.name,
        // slug omitted when empty so it is not overwritten with a blank value.
        slug: input.slug || undefined,
        country: input.country ?? '',
        website_url: input.website_url ?? '',
      }),
    onSuccess: () => {
      toast.success('Brand updated')
      invalidate()
      setDialogOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.brands.delete(id),
    onSuccess: () => {
      toast.success('Brand deleted')
      invalidate()
      setDeleting(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const openCreate = () => {
    setEditing(null)
    form.reset(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (brand: Brand) => {
    setEditing(brand)
    form.reset({
      name: brand.name,
      slug: brand.slug,
      country: brand.country ?? '',
      website_url: brand.website_url ?? '',
    })
    setDialogOpen(true)
  }

  const onSubmit = form.handleSubmit((values) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, input: values })
    } else {
      createMutation.mutate({
        name: values.name,
        slug: values.slug || undefined,
        country: values.country || undefined,
        website_url: values.website_url || undefined,
      })
    }
  })

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brands"
        description="Manage candle and fragrance brands."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            New brand
          </Button>
        }
      />

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <LoadingTable columns={5} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Website</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.brands.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell className="font-medium">{brand.name}</TableCell>
                <TableCell>{brand.slug}</TableCell>
                <TableCell>{brand.country ?? '—'}</TableCell>
                <TableCell>
                  {brand.website_url ? (
                    <a
                      href={brand.website_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {brand.website_url}
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(brand)}
                      aria-label={`Edit ${brand.name}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(brand)}
                      aria-label={`Delete ${brand.name}`}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit brand' : 'Create brand'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message}>
              <Input id="name" {...form.register('name')} />
            </Field>
            <Field label="Slug" htmlFor="slug">
              <Input id="slug" placeholder="auto-generated if empty" {...form.register('slug')} />
            </Field>
            <Field label="Country" htmlFor="country">
              <Input id="country" {...form.register('country')} />
            </Field>
            <Field
              label="Website URL"
              htmlFor="website_url"
              error={form.formState.errors.website_url?.message}
            >
              <Input id="website_url" {...form.register('website_url')} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : editing ? 'Save changes' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete brand</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{deleting?.name}</span>? This
            cannot be undone. Brands with products assigned to them cannot be deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
