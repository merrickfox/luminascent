import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, FileCode } from 'lucide-react'
import {
  scraperApi,
  productImageUrl,
  productDomUrl,
  type RecipePreview,
  type CapturedData,
} from '@/lib/scraper-api'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScraperGate } from './scraper-shared'

function show(value: unknown): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.join(' · ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function JsonCard({ title, description, value }: { title: string; description: string; value: unknown }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 flex-1">
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
          {value == null ? 'null' : JSON.stringify(value, null, 2)}
        </pre>
      </CardContent>
    </Card>
  )
}

// The recipe-vs-capture diagnostic: did the blueprint extract the same value from the
// saved DOM that capture recorded? A diff means the recipe needs a re-tag; a match with a
// wrong final value points downstream to the LLM (reprocess).
function RecipeCompare({ preview, data }: { preview: RecipePreview; data: CapturedData | null }) {
  if (!preview.available) {
    return (
      <p className="text-sm text-muted-foreground">
        Recipe preview unavailable{preview.reason ? ` (${preview.reason})` : ''}.
      </p>
    )
  }

  const captured = data?.fields ?? {}
  const keys = Array.from(new Set([...Object.keys(preview.fields ?? {}), ...Object.keys(captured)]))

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Captured (data.json)</TableHead>
            <TableHead>Recipe now (saved DOM)</TableHead>
            <TableHead className="w-24 text-right">Match</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => {
            const cap = captured[key] ?? null
            const field = preview.fields?.[key]
            const now = field?.value ?? null
            const same = JSON.stringify(cap) === JSON.stringify(now)
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">{key}</TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground" title={show(cap)}>
                  {show(cap)}
                </TableCell>
                <TableCell className="max-w-xs truncate" title={show(now)}>
                  {show(now)}
                </TableCell>
                <TableCell className="text-right">
                  {!field?.resolved ? (
                    <Badge variant="outline">unresolved</Badge>
                  ) : same ? (
                    <Badge variant="secondary">match</Badge>
                  ) : (
                    <Badge variant="destructive">diff</Badge>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {preview.images?.length ? (
        <div>
          <p className="mb-2 text-sm font-medium">Image recipes</p>
          <div className="flex flex-wrap gap-2">
            {preview.images.map((img) => (
              <Badge key={img.order} variant={img.resolved ? 'secondary' : 'destructive'} title={img.resolvedUrl ?? ''}>
                #{img.order} {img.resolved ? 'resolved' : 'unresolved'}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProductDetail({ folder, slug }: { folder: string; slug: string }) {
  const [domOpen, setDomOpen] = useState(false)

  const bundle = useQuery({
    queryKey: ['scraper', 'product', folder, slug],
    queryFn: () => scraperApi.products.get(folder, slug),
  })
  const preview = useQuery({
    queryKey: ['scraper', 'recipe', folder, slug],
    queryFn: () => scraperApi.recipePreview(folder, slug),
  })

  if (bundle.error) return <p className="text-sm text-destructive">{(bundle.error as Error).message}</p>
  if (bundle.isLoading || !bundle.data) return <p className="text-sm text-muted-foreground">Loading…</p>

  const { data, llmOutput, product, images, domFile } = bundle.data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {data?.source_url ? (
          <Button variant="outline" size="sm" render={<a href={data.source_url} target="_blank" rel="noreferrer" />}>
            <ExternalLink className="size-3.5" /> Live page
          </Button>
        ) : null}
        {domFile ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setDomOpen(true)}>
              <FileCode className="size-3.5" /> Captured DOM
            </Button>
            <Button
              variant="ghost"
              size="sm"
              render={<a href={productDomUrl(folder, slug)} target="_blank" rel="noreferrer" />}
            >
              open in tab
            </Button>
          </>
        ) : null}
      </div>

      {images.length ? (
        <div className="flex flex-wrap gap-3">
          {images.map((file) => (
            <img
              key={file}
              src={productImageUrl(folder, slug, file)}
              alt={file}
              className="h-40 w-40 rounded-md border border-border object-cover"
              loading="lazy"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No images captured.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipe preview vs capture</CardTitle>
          <CardDescription>
            What the blueprint extracts from the saved DOM now, compared to what capture recorded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.isLoading || !preview.data ? (
            <p className="text-sm text-muted-foreground">Resolving recipes…</p>
          ) : (
            <RecipeCompare preview={preview.data} data={data} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <JsonCard title="Captured" description="data.json fields" value={data?.fields ?? null} />
        <JsonCard title="LLM output" description="llm_output.json fields" value={llmOutput?.fields ?? null} />
        <JsonCard title="Assembled" description="products.json entry" value={product} />
      </div>

      <Sheet open={domOpen} onOpenChange={setDomOpen}>
        <SheetContent className="w-full sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Captured DOM — {slug}</SheetTitle>
          </SheetHeader>
          <iframe
            title="captured-dom"
            src={domOpen ? productDomUrl(folder, slug) : undefined}
            className="mt-4 h-[calc(100vh-8rem)] w-full rounded border border-border bg-white"
            sandbox=""
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function ScraperProductPage() {
  const { folder = '', slug = '' } = useParams()
  return (
    <div className="space-y-6">
      <PageHeader
        title={slug}
        description={folder}
        actions={
          <Button variant="outline" size="sm" render={<Link to={`/scraper/${folder}`} />}>
            <ArrowLeft className="size-3.5" /> Site
          </Button>
        }
      />
      <ScraperGate>
        <ProductDetail folder={folder} slug={slug} />
      </ScraperGate>
    </div>
  )
}
