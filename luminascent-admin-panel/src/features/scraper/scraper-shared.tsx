import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { WifiOff } from 'lucide-react'
import { scraperApi, type ProductFlag, type WorklistStatus } from '@/lib/scraper-api'
import { SCRAPER_HOST } from '@/lib/config'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Probe the local server once; the section only works when it's running, so gate the
// whole subtree behind a friendly offline card rather than letting every query error.
export function ScraperGate({ children }: { children: ReactNode }) {
  const { isLoading, isError } = useQuery({
    queryKey: ['scraper', 'health'],
    queryFn: () => scraperApi.health(),
    retry: false,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.status === 'error' ? 5_000 : false),
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Connecting to scraper server…</p>
  }

  if (isError) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <WifiOff className="size-4" /> Scraper server offline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This section talks to the local scraper server at{' '}
            <code className="rounded bg-muted px-1 py-0.5">{SCRAPER_HOST}</code>, which holds the
            capture artifacts and runs the pipeline.
          </p>
          <p>
            Start it with <code className="rounded bg-muted px-1 py-0.5">node server/server.js</code>{' '}
            in the <code className="rounded bg-muted px-1 py-0.5">scraper/</code> directory, then this
            page will connect automatically.
          </p>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}

const STATUS_VARIANT: Record<WorklistStatus, 'outline' | 'secondary' | 'default'> = {
  'not-started': 'outline',
  configured: 'secondary',
  captured: 'secondary',
  assembled: 'default',
}

const STATUS_LABEL: Record<WorklistStatus, string> = {
  'not-started': 'Not started',
  configured: 'Configured',
  captured: 'Captured',
  assembled: 'Assembled',
}

export function StatusBadge({ status }: { status: WorklistStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}

const FLAG_LABEL: Record<ProductFlag, string> = {
  'no-name': 'no name',
  'no-images': 'no images',
  'no-price': 'no price',
  'no-notes-accords': 'no notes/accords',
  'llm-errors': 'LLM errors',
}

export function FlagBadges({ flags }: { flags: ProductFlag[] }) {
  if (!flags.length) {
    return <Badge variant="secondary">ok</Badge>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant="destructive">
          {FLAG_LABEL[flag] ?? flag}
        </Badge>
      ))}
    </div>
  )
}
