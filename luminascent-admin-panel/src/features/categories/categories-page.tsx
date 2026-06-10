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

const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
})

type CreateCategoryForm = z.infer<typeof createCategorySchema>

export function CategoriesPage() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
  })

  const form = useForm<CreateCategoryForm>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: '', slug: '' },
  })

  const createMutation = useMutation({
    mutationFn: api.categories.create,
    onSuccess: () => {
      toast.success('Category created')
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      form.reset()
      setOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onSubmit = form.handleSubmit((values) => {
    createMutation.mutate({
      name: values.name,
      slug: values.slug || undefined,
    })
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="Product types such as candle, perfume, and wax melt."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <Plus />
              New category
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create category</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message}>
                  <Input id="name" {...form.register('name')} />
                </Field>
                <Field label="Slug" htmlFor="slug">
                  <Input id="slug" placeholder="auto-generated if empty" {...form.register('slug')} />
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
        <LoadingTable columns={2} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">{category.name}</TableCell>
                <TableCell>{category.slug}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
