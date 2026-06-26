import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, ImageOff, Trash2 } from 'lucide-react'
import { scraperApi, productImageUrl, type SiteProduct } from '@/lib/scraper-api'
import { PageHeader } from '@/components/page-header'
import { LoadingTable } from '@/components/loading-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ScraperGate, FlagBadges } from './scraper-shared'
import { PipelineRunner } from './pipeline-runner'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Thumb({ folder, product }: { folder: string; product: SiteProduct }) {
  if (!product.primaryImage) {
    return (
      <div className="flex size-12 items-center justify-center rounded bg-muted text-muted-foreground">
        <ImageOff className="size-4" />
      </div>
    )
  }
  return (
    <img
      src={productImageUrl(folder, product.slug, product.primaryImage)}
      alt={product.name ?? product.slug}
      className="size-12 rounded object-cover"
      loading="lazy"
    />
  )
}

function SiteDetail({ folder }: { folder: string }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['scraper', 'site', folder],
    queryFn: () => scraperApi.sites.get(folder),
  })

  const deleteMutation = useMutation({
    mutationFn: (slugs: string[]) => scraperApi.products.bulkDelete(folder, slugs),
    onSuccess: (result) => {
      const failed = result.results.filter((r) => !r.ok)
      if (result.deleted > 0) {
        toast.success(
          `Deleted ${result.deleted} product${result.deleted === 1 ? '' : 's'}` +
            (result.removedFromProductsJson
              ? ` (${result.removedFromProductsJson} from products.json)`
              : ''),
        )
      }
      if (failed.length) toast.error(`${failed.length} could not be deleted`)
      setSelected(new Set())
      setPendingDelete(null)
      queryClient.invalidateQueries({ queryKey: ['scraper', 'site', folder] })
      queryClient.invalidateQueries({ queryKey: ['scraper', 'worklist'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>
  if (isLoading || !data) return <LoadingTable columns={6} />

  const cfg = data.config
  const products = data.products
  const flaggedCount = products.filter((p) => p.flags.length).length
  const allSelected = products.length > 0 && selected.size === products.length

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(products.map((p) => p.slug)) : new Set())

  const toggleOne = (slug: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(slug)
      else next.delete(slug)
      return next
    })

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Host" value={cfg.host ?? '—'} />
          <Stat label="Browse recipe" value={cfg.browse ? 'set' : 'missing'} />
          <Stat label="Fields" value={cfg.product?.fields?.length ?? 0} />
          <Stat label="Image rules" value={(cfg.images ?? []).length} />
          <Stat label="Products" value={products.length} />
          <Stat label="In products.json" value={data.productsJsonCount} />
          <Stat label="Flagged" value={flaggedCount} />
        </CardContent>
      </Card>

      <PipelineRunner folder={folder} />

      <div className="flex h-9 items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {selected.size > 0 ? `${selected.size} selected` : `${products.length} products`}
        </p>
        {selected.size > 0 ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setPendingDelete(Array.from(selected))}
          >
            <Trash2 className="size-3.5" /> Delete {selected.size}
          </Button>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(c) => toggleAll(c === true)}
                aria-label="Select all products"
              />
            </TableHead>
            <TableHead className="w-16" />
            <TableHead>Product</TableHead>
            <TableHead>Artifacts</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead className="text-right">Images</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.slug} data-state={selected.has(product.slug) ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  checked={selected.has(product.slug)}
                  onCheckedChange={(c) => toggleOne(product.slug, c === true)}
                  aria-label={`Select ${product.name ?? product.slug}`}
                />
              </TableCell>
              <TableCell>
                <Thumb folder={folder} product={product} />
              </TableCell>
              <TableCell>
                <Link
                  to={`/scraper/${folder}/${product.slug}`}
                  className="font-medium text-primary hover:underline"
                >
                  {product.name ?? product.slug}
                </Link>
                <p className="text-xs text-muted-foreground">{product.slug}</p>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {product.hasData ? <Badge variant="secondary">data</Badge> : null}
                  {product.hasLlmOutput ? <Badge variant="secondary">llm</Badge> : null}
                  {product.inProductsJson ? <Badge variant="secondary">assembled</Badge> : null}
                  {product.hasDom ? <Badge variant="outline">dom</Badge> : null}
                </div>
              </TableCell>
              <TableCell>
                <FlagBadges flags={product.flags} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{product.imageCount}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPendingDelete([product.slug])}
                  aria-label={`Delete ${product.name ?? product.slug}`}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No products captured yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {pendingDelete?.length ?? 0} extracted product
              {pendingDelete?.length === 1 ? '' : 's'}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the captured files (data, LLM output, images, DOM) and the matching{' '}
            <code className="rounded bg-muted px-1 py-0.5">products.json</code> entries from disk.
            It does <span className="font-medium text-foreground">not</span> touch products already
            pushed to the backend. Re-capture to restore.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ScraperSitePage() {
  const { folder = '' } = useParams()
  return (
    <div className="space-y-6">
      <PageHeader
        title={folder}
        description="Captured products, recipe blueprint, and pipeline controls."
        actions={
          <Button variant="outline" size="sm" render={<Link to="/scraper" />}>
            <ArrowLeft className="size-3.5" /> Worklist
          </Button>
        }
      />
      <ScraperGate>
        <SiteDetail folder={folder} />
      </ScraperGate>
    </div>
  )
}
