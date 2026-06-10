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

const createNoteSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
  note_family: z.string().optional(),
})

type CreateNoteForm = z.infer<typeof createNoteSchema>

export function NotesPage() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['notes'],
    queryFn: () => api.notes.list(),
  })

  const form = useForm<CreateNoteForm>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: { name: '', slug: '', note_family: '' },
  })

  const createMutation = useMutation({
    mutationFn: api.notes.create,
    onSuccess: () => {
      toast.success('Note created')
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      form.reset()
      setOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onSubmit = form.handleSubmit((values) => {
    createMutation.mutate({
      name: values.name,
      slug: values.slug || undefined,
      note_family: values.note_family || undefined,
    })
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notes"
        description="Scent notes used in product pyramids."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <Plus />
              New note
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create note</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message}>
                  <Input id="name" {...form.register('name')} />
                </Field>
                <Field label="Slug" htmlFor="slug">
                  <Input id="slug" placeholder="auto-generated if empty" {...form.register('slug')} />
                </Field>
                <Field label="Note family" htmlFor="note_family">
                  <Input id="note_family" placeholder="citrus, woods, gourmand..." {...form.register('note_family')} />
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
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Family</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.notes.map((note) => (
              <TableRow key={note.id}>
                <TableCell className="font-medium">{note.name}</TableCell>
                <TableCell>{note.slug}</TableCell>
                <TableCell>{note.note_family ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
