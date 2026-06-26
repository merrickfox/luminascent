import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { scraperApi, type WorklistStatus } from '@/lib/scraper-api'
import { PageHeader } from '@/components/page-header'
import { LoadingTable } from '@/components/loading-table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScraperGate, StatusBadge } from './scraper-shared'

const STATUS_ORDER: WorklistStatus[] = ['assembled', 'captured', 'configured', 'not-started']

function WorklistTable() {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<WorklistStatus | 'all'>('all')

  const { data, isLoading, error } = useQuery({
    queryKey: ['scraper', 'worklist'],
    queryFn: () => scraperApi.worklist(),
  })

  const counts = useMemo(() => {
    const by: Record<string, number> = {}
    for (const brand of data?.brands ?? []) by[brand.status] = (by[brand.status] ?? 0) + 1
    return by
  }, [data])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.brands ?? []).filter((brand) => {
      if (statusFilter !== 'all' && brand.status !== statusFilter) return false
      if (q && !brand.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, query, statusFilter])

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>
  if (isLoading) return <LoadingTable columns={5} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter brands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Badge
          variant={statusFilter === 'all' ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setStatusFilter('all')}
        >
          All {data?.brands.length ?? 0}
        </Badge>
        {STATUS_ORDER.map((status) => (
          <Badge
            key={status}
            variant={statusFilter === status ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
          >
            {status} {counts[status] ?? 0}
          </Badge>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Notes (raw list)</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead className="w-28 text-right">Site</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((brand) => (
            <TableRow key={`${brand.name}-${brand.folder ?? 'none'}`}>
              <TableCell className="font-medium">{brand.name}</TableCell>
              <TableCell className="text-muted-foreground">{brand.annotation ?? '—'}</TableCell>
              <TableCell>
                <StatusBadge status={brand.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {brand.productCount ?? '—'}
              </TableCell>
              <TableCell className="text-right">
                {brand.folder ? (
                  <Button variant="ghost" size="sm" render={<Link to={`/scraper/${brand.folder}`} />}>
                    Open <ArrowRight className="size-3.5" />
                  </Button>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No brands match.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}

export function ScraperWorklistPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Scraper"
        description="Brand worklist from data/raw-brands.txt, cross-referenced with captured sites."
      />
      <ScraperGate>
        <WorklistTable />
      </ScraperGate>
    </div>
  )
}
