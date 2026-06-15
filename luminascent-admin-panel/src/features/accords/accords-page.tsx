import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { ColorSwatch } from '@/components/color-swatch'
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

const createAccordSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
})

type CreateAccordForm = z.infer<typeof createAccordSchema>

export function AccordsPage() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['accords'],
    queryFn: () => api.accords.list(),
  })

  const form = useForm<CreateAccordForm>({
    resolver: zodResolver(createAccordSchema),
    defaultValues: { name: '', slug: '' },
  })

  const createMutation = useMutation({
    mutationFn: api.accords.create,
    onSuccess: () => {
      toast.success('Accord created')
      queryClient.invalidateQueries({ queryKey: ['accords'] })
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
        title="Accords"
        description="Main scent accords such as woody, vanilla, and smoky."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <Plus />
              New accord
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create accord</DialogTitle>
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
        <LoadingTable columns={3} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Color</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.accords.map((accord) => (
              <TableRow key={accord.id}>
                <TableCell>
                  <ColorSwatch color={accord.color} colorGradient={accord.color_gradient} />
                </TableCell>
                <TableCell className="font-medium">{accord.name}</TableCell>
                <TableCell>{accord.slug}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
