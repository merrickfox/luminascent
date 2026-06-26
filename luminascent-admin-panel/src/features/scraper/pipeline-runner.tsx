import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Play } from 'lucide-react'
import { scraperApi, type PipelineCommand } from '@/lib/scraper-api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const FLAGS: Array<{ flag: string; label: string; hint: string }> = [
  { flag: '--reprocess', label: 'Reprocess', hint: 'Re-run the LLM over every product (ignores cache)' },
  { flag: '--refetch-images', label: 'Refetch images', hint: 'Re-upload images for products that already exist' },
  { flag: '--fresh', label: 'Fresh', hint: 'Replace products.json instead of upserting' },
  { flag: '--dry-run', label: 'Dry run', hint: 'Skip LLM calls (test the assembler)' },
]

const COMMANDS: Array<{ command: PipelineCommand; label: string; hint: string }> = [
  { command: 'run', label: 'Run', hint: 'LLM extract + assemble products.json' },
  { command: 'push', label: 'Push', hint: 'Upload products.json to the backend' },
  { command: 'sync', label: 'Sync', hint: 'Run then push' },
]

export function PipelineRunner({ folder }: { folder: string }) {
  const queryClient = useQueryClient()
  const [flags, setFlags] = useState<Set<string>>(new Set())
  const logRef = useRef<HTMLPreElement>(null)
  // Tracks the job we're observing so the completion toast fires once, and only for a
  // run we actually watched go from running -> settled (not when re-attaching to an
  // already-finished job after navigating back).
  const trackRef = useRef<{ id: string | null; sawRunning: boolean; settled: boolean }>({
    id: null,
    sawRunning: false,
    settled: false,
  })

  // The active job is derived from the SERVER (latest job for this folder), not local
  // state, so it survives navigating away and back — the child process keeps running on
  // the server regardless of the UI, and remounting re-attaches to it.
  const { data: job } = useQuery({
    queryKey: ['scraper', 'jobs', folder],
    queryFn: async () => {
      const { jobs } = await scraperApi.jobs.list()
      return jobs.find((j) => j.folder === folder) ?? null
    },
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1000 : false),
  })

  const startMutation = useMutation({
    mutationFn: (command: PipelineCommand) =>
      scraperApi.pipeline.start(command, folder, Array.from(flags)),
    onSuccess: (result) => {
      if (result.error || !result.job) {
        toast.error(result.error ?? 'Failed to start pipeline')
        return
      }
      // Reflect the new job immediately, then let polling take over.
      queryClient.setQueryData(['scraper', 'jobs', folder], result.job)
      queryClient.invalidateQueries({ queryKey: ['scraper', 'jobs', folder] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // Auto-scroll the log to the bottom as lines stream in.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log.length])

  // On settle: toast + refresh the site so the QA grid reflects new data. Only fires for
  // a job we observed running in this session.
  useEffect(() => {
    if (!job) return
    const track = trackRef.current
    if (track.id !== job.id) {
      trackRef.current = { id: job.id, sawRunning: job.status === 'running', settled: false }
    } else if (job.status === 'running') {
      track.sawRunning = true
    }

    const current = trackRef.current
    if (job.status !== 'running' && current.sawRunning && !current.settled) {
      current.settled = true
      if (job.status === 'done') toast.success(`${job.command} finished for ${folder}`)
      else toast.error(`${job.command} failed (exit ${job.exitCode})`)
      queryClient.invalidateQueries({ queryKey: ['scraper', 'site', folder] })
    }
  }, [job, folder, queryClient])

  const running = job?.status === 'running' || startMutation.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline</CardTitle>
        <CardDescription>
          Runs <code className="rounded bg-muted px-1 py-0.5">pipeline:&lt;command&gt; --brand {folder}</code>{' '}
          on the local server and streams output here. Keeps running if you navigate away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4">
          {FLAGS.map(({ flag, label, hint }) => (
            <div key={flag} className="flex items-center gap-2">
              <Checkbox
                id={`flag-${flag}`}
                checked={flags.has(flag)}
                disabled={running}
                onCheckedChange={(checked) =>
                  setFlags((current) => {
                    const next = new Set(current)
                    if (checked === true) next.add(flag)
                    else next.delete(flag)
                    return next
                  })
                }
              />
              <Label htmlFor={`flag-${flag}`} title={hint} className="cursor-pointer">
                {label}
              </Label>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {COMMANDS.map(({ command, label, hint }) => (
            <Button
              key={command}
              variant={command === 'sync' ? 'default' : 'outline'}
              disabled={running}
              title={hint}
              onClick={() => startMutation.mutate(command)}
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {label}
            </Button>
          ))}
          {job ? (
            <Badge
              variant={
                job.status === 'done'
                  ? 'secondary'
                  : job.status === 'failed'
                    ? 'destructive'
                    : 'default'
              }
              className="self-center"
            >
              {job.command}: {job.status}
              {job.exitCode != null ? ` (exit ${job.exitCode})` : ''}
            </Badge>
          ) : null}
        </div>

        {job ? (
          <pre
            ref={logRef}
            className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
          >
            {job.log.join('\n')}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  )
}
