import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ImageOff } from 'lucide-react'
import { scraperApi, productImageUrl, type SiteProduct } from '@/lib/scraper-api'
import { PageHeader } from '@/components/page-header'
import { LoadingTable } from '@/components/loading-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  const { data, isLoading, error } = useQuery({
    queryKey: ['scraper', 'site', folder],
    queryFn: () => scraperApi.sites.get(folder),
  })

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>
  if (isLoading || !data) return <LoadingTable columns={5} />

  const cfg = data.config
  const flaggedCount = data.products.filter((p) => p.flags.length).length

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Host" value={cfg.host ?? '—'} />
          <Stat label="Browse recipe" value={cfg.browse ? 'set' : 'missing'} />
          <Stat label="Fields" value={cfg.product?.fields?.length ?? 0} />
          <Stat label="Image rules" value={(cfg.images ?? []).length} />
          <Stat label="Products" value={data.products.length} />
          <Stat label="In products.json" value={data.productsJsonCount} />
          <Stat label="Flagged" value={flaggedCount} />
        </CardContent>
      </Card>

      <PipelineRunner folder={folder} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16" />
            <TableHead>Product</TableHead>
            <TableHead>Artifacts</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead className="text-right">Images</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.products.map((product) => (
            <TableRow key={product.slug}>
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
            </TableRow>
          ))}
          {data.products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No products captured yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
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
