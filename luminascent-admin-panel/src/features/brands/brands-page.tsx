import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const createBrandSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
  country: z.string().optional(),
  website_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})

type CreateBrandForm = z.infer<typeof createBrandSchema>

export function BrandsPage() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.brands.list(),
  })

  const form = useForm<CreateBrandForm>({
    resolver: zodResolver(createBrandSchema),
    defaultValues: {
      name: '',
      slug: '',
      country: '',
      website_url: '',
    },
  })

  const createMutation = useMutation({
    mutationFn: api.brands.create,
    onSuccess: () => {
      toast.success('Brand created')
      queryClient.invalidateQueries({ queryKey: ['brands'] })
      form.reset()
      setOpen(false)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    createMutation.mutate({
      name: values.name,
      slug: values.slug || undefined,
      country: values.country || undefined,
      website_url: values.website_url || undefined,
    })
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brands"
        description="Manage candle and fragrance brands."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <Plus />
              New brand
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create brand</DialogTitle>
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
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Creating...' : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <LoadingTable columns={4} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Website</TableHead>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
