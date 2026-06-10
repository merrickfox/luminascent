import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { ProductListFilters } from '@/lib/types'
import { useEnv } from '@/context/env-context'
import { PageHeader } from '@/components/page-header'
import { LoadingTable } from '@/components/loading-table'
import { CreateProductDialog } from '@/features/products/create-product-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function ProductsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { environment } = useEnv()
  const [filters, setFilters] = useState<ProductListFilters>({
    sort: 'name',
    limit: 50,
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
  })
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.brands.list(),
  })

  const productsQuery = useQuery({
    queryKey: ['products', environment.id, filters],
    queryFn: () => api.products.list(filters),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.products.bulkDelete(ids),
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted.length} product(s)`)
      if (result.notFound.length > 0) {
        toast.warning(`${result.notFound.length} product(s) were not found`)
      }
      setSelectedIds(new Set())
      setBulkDeleteOpen(false)
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const brandById = useMemo(() => {
    const map = new Map<string, string>()
    for (const brand of brandsQuery.data?.brands ?? []) {
      map.set(brand.id, brand.name)
    }
    return map
  }, [brandsQuery.data?.brands])

  const categoryById = useMemo(() => {
    const map = new Map<string, string>()
    for (const category of categoriesQuery.data?.categories ?? []) {
      map.set(category.id, category.name)
    }
    return map
  }, [categoriesQuery.data?.categories])

  const products = productsQuery.data?.products ?? []
  const allSelected = products.length > 0 && products.every((product) => selectedIds.has(product.id))
  const someSelected = selectedIds.size > 0

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(products.map((product) => product.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Browse, edit, and manage catalog products."
        actions={
          <div className="flex items-center gap-2">
            {someSelected ? (
              <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 />
                Delete selected ({selectedIds.size})
              </Button>
            ) : null}
            <CreateProductDialog />
          </div>
        }
      />

      <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          value={filters.category ?? 'all'}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              category: !value || value === 'all' ? undefined : value,
            }))
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categoriesQuery.data?.categories.map((category) => (
              <SelectItem key={category.id} value={category.slug}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.brand ?? 'all'}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              brand: !value || value === 'all' ? undefined : value,
            }))
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Brand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {brandsQuery.data?.brands.map((brand) => (
              <SelectItem key={brand.id} value={brand.slug}>
                {brand.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          min={0}
          max={5}
          step={0.1}
          placeholder="Min rating"
          value={filters.min_rating ?? ''}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              min_rating: event.target.value ? Number(event.target.value) : undefined,
            }))
          }
        />

        <Select
          value={filters.sort ?? 'name'}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              sort: value as ProductListFilters['sort'],
            }))
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="rating">Rating</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={() => {
            setFilters({ sort: 'name', limit: 50 })
            setSelectedIds(new Set())
          }}
        >
          Clear filters
        </Button>
      </div>

      {productsQuery.error ? (
        <p className="text-sm text-destructive">{(productsQuery.error as Error).message}</p>
      ) : productsQuery.isLoading ? (
        <LoadingTable columns={6} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label="Select all products"
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No products found.
                </TableCell>
              </TableRow>
            ) : (
              products.map((product) => (
                <TableRow
                  key={product.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/products/${product.slug}`)}
                >
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(product.id)}
                      onCheckedChange={(checked) => toggleOne(product.id, checked === true)}
                      aria-label={`Select ${product.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      to={`/products/${product.slug}`}
                      className="hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {product.name}
                    </Link>
                  </TableCell>
                  <TableCell>{product.slug}</TableCell>
                  <TableCell>{categoryById.get(product.category_id) ?? '—'}</TableCell>
                  <TableCell>
                    {product.brand_id ? brandById.get(product.brand_id) ?? '—' : '—'}
                  </TableCell>
                  <TableCell>
                    {product.is_discontinued ? 'Discontinued' : 'Active'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete selected products</DialogTitle>
            <DialogDescription>
              This will permanently delete {selectedIds.size} product(s) and their images.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
            >
              {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete products'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
