import { useCallback, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileJson,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useEnv } from '@/context/env-context'
import type { ImportOptions, ParsedImportFile } from '@/lib/types'
import { cn } from '@/lib/utils'
import { parseImportFile } from '@/features/import/parse-import-file'
import {
  type ImportItemState,
  useImportRunner,
} from '@/features/import/use-import-runner'

function statusBadgeVariant(status: ImportItemState['status']) {
  switch (status) {
    case 'created':
      return 'default' as const
    case 'updated':
      return 'secondary' as const
    case 'skipped':
      return 'outline' as const
    case 'failed':
      return 'destructive' as const
    case 'running':
      return 'secondary' as const
    default:
      return 'outline' as const
  }
}

function phaseLabel(phase: string) {
  switch (phase) {
    case 'ensuring-brand':
      return 'Ensuring brand'
    case 'importing':
      return 'Importing products'
    case 'done':
      return 'Complete'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Ready'
  }
}

function ImportResultRow({ item }: { item: ImportItemState }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails =
    Boolean(item.error) ||
    Boolean(item.result?.warnings.length) ||
    Boolean(item.result?.images.failed.length)

  return (
    <>
      <TableRow>
        <TableCell className="max-w-[280px] truncate font-medium">{item.product.name}</TableCell>
        <TableCell className="font-mono text-xs">{item.product.slug ?? '—'}</TableCell>
        <TableCell>
          <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
        </TableCell>
        <TableCell className="text-right text-sm text-muted-foreground">
          {item.result
            ? `${item.result.images.added} added · ${item.result.images.kept} kept · ${item.result.images.failed.length} failed`
            : item.error ?? '—'}
        </TableCell>
        <TableCell className="w-10">
          {hasDetails ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          ) : null}
        </TableCell>
      </TableRow>
      {expanded && hasDetails ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="space-y-2 py-2 text-sm">
              {item.error ? (
                <p className="text-destructive">{item.error}</p>
              ) : null}
              {item.result?.warnings.map((warning) => (
                <p key={warning} className="text-muted-foreground">
                  {warning}
                </p>
              ))}
              {item.result?.images.failed.map((failure) => (
                <p key={failure.url} className="text-destructive">
                  Image failed: {failure.error}
                </p>
              ))}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

export function ImportPage() {
  const { environment } = useEnv()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsedFile, setParsedFile] = useState<ParsedImportFile | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [options, setOptions] = useState<ImportOptions>({
    update_existing: true,
    refetch_images: false,
  })

  const {
    phase,
    brandResult,
    items,
    aggregate,
    progress,
    runImport,
    retryFailed,
    cancelImport,
    resetImport,
    isRunning,
  } = useImportRunner()

  const handleFile = useCallback(async (file: File) => {
    setParseError(null)

    try {
      const text = await file.text()
      const parsed = parseImportFile(text)
      setParsedFile(parsed)
      setFileName(file.name)
      resetImport()
    } catch (error) {
      setParsedFile(null)
      setFileName(null)
      setParseError(error instanceof Error ? error.message : 'Failed to parse file')
      toast.error(error instanceof Error ? error.message : 'Failed to parse file')
    }
  }, [resetImport])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragActive(false)

      const file = event.dataTransfer.files[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const startImport = () => {
    if (!parsedFile) return

    void runImport({
      products: parsedFile.products,
      brandName: parsedFile.brandName,
      brandSlug: parsedFile.brandSlug,
      options,
    })
  }

  const failedCount = items.filter((item) => item.status === 'failed').length
  const isProd = environment.id === 'prod'

  return (
    <div className="space-y-8">
      <PageHeader
        title="Import"
        description="Upload scraped products.json files to populate brands, products, notes, accords, and images."
      />

      <Card>
        <CardHeader>
          <CardTitle>Target environment</CardTitle>
          <CardDescription>
            Imports run against the environment selected in the sidebar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant={isProd ? 'destructive' : 'secondary'}>{environment.label}</Badge>
          <span className="truncate text-sm text-muted-foreground">{environment.host}</span>
          {isProd ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              You are targeting production
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload products.json</CardTitle>
          <CardDescription>
            Drop a scraped brand export or choose a file from your machine.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 transition-colors',
              dragActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
            )}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragActive(false)
            }}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Drop products.json here</p>
            <p className="text-xs text-muted-foreground">or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </div>

          {fileName ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileJson className="size-4" />
              <span>{fileName}</span>
            </div>
          ) : null}

          {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}
        </CardContent>
      </Card>

      {parsedFile ? (
        <Card>
          <CardHeader>
            <CardTitle>Preflight summary</CardTitle>
            <CardDescription>Review what will be imported before starting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Brand</p>
                <p className="font-medium">{parsedFile.brandName}</p>
                <p className="font-mono text-xs text-muted-foreground">{parsedFile.brandSlug}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Products</p>
                <p className="font-medium">{parsedFile.productCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Images</p>
                <p className="font-medium">{parsedFile.imageCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Invalid records</p>
                <p className="font-medium">{parsedFile.invalidCount}</p>
              </div>
            </div>

            {parsedFile.invalidProducts.length > 0 ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p className="mb-2 font-medium text-destructive">Skipped invalid records</p>
                <ul className="space-y-1 text-muted-foreground">
                  {parsedFile.invalidProducts.slice(0, 5).map((entry) => (
                    <li key={entry.index}>
                      Row {entry.index + 1}: {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="update-existing"
                  checked={options.update_existing}
                  onCheckedChange={(checked) =>
                    setOptions((current) => ({
                      ...current,
                      update_existing: checked === true,
                    }))
                  }
                  disabled={isRunning}
                />
                <div className="space-y-1">
                  <Label htmlFor="update-existing">Update existing products</Label>
                  <p className="text-xs text-muted-foreground">
                    Match by slug and overwrite product data when it already exists.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="refetch-images"
                  checked={options.refetch_images}
                  onCheckedChange={(checked) =>
                    setOptions((current) => ({
                      ...current,
                      refetch_images: checked === true,
                    }))
                  }
                  disabled={isRunning}
                />
                <div className="space-y-1">
                  <Label htmlFor="refetch-images">Re-fetch images for existing products</Label>
                  <p className="text-xs text-muted-foreground">
                    Leave off to keep existing R2 images on re-import. New products always import images.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={startImport} disabled={isRunning || parsedFile.productCount === 0}>
                {isRunning ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Start import'
                )}
              </Button>
              {isRunning ? (
                <Button type="button" variant="outline" onClick={cancelImport}>
                  <X className="size-4" />
                  Cancel
                </Button>
              ) : null}
              {phase === 'done' && failedCount > 0 ? (
                <Button type="button" variant="secondary" onClick={() => void retryFailed()}>
                  Retry failed ({failedCount})
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {phase !== 'idle' ? (
        <Card>
          <CardHeader>
            <CardTitle>Import progress</CardTitle>
            <CardDescription>{phaseLabel(phase)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  {aggregate.completed} / {aggregate.total} products
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>

            {brandResult ? (
              <div className="rounded-lg border border-border p-4 text-sm">
                <p className="font-medium">Brand {brandResult.status}</p>
                <p className="text-muted-foreground">
                  {brandResult.brand.name} ({brandResult.brand.slug})
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-lg font-semibold">{aggregate.created}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Updated</p>
                <p className="text-lg font-semibold">{aggregate.updated}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Skipped</p>
                <p className="text-lg font-semibold">{aggregate.skipped}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-lg font-semibold">{aggregate.failed}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Images added</p>
                <p className="text-lg font-semibold">{aggregate.imagesAdded}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Image failures</p>
                <p className="text-lg font-semibold">{aggregate.imagesFailed}</p>
              </div>
            </div>

            {items.length > 0 ? (
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Images</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <ImportResultRow key={item.index} item={item} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
