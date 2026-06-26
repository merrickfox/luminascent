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
  const [jobId, setJobId] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const settledRef = useRef<string | null>(null)

  const startMutation = useMutation({
    mutationFn: (command: PipelineCommand) =>
      scraperApi.pipeline.start(command, folder, Array.from(flags)),
    onSuccess: (result) => {
      if (result.error || !result.job) {
        toast.error(result.error ?? 'Failed to start pipeline')
        return
      }
      settledRef.current = null
      setJobId(result.job.id)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const { data } = useQuery({
    queryKey: ['scraper', 'job', jobId],
    queryFn: () => scraperApi.jobs.get(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) =>
      query.state.data?.job.status === 'running' ? 1000 : false,
  })

  const job = data?.job

  // Auto-scroll the log to the bottom as lines stream in.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log.length])

  // Fire once when a job settles: toast + refresh the site so the QA grid reflects
  // newly assembled/pushed data.
  useEffect(() => {
    if (!job || job.status === 'running') return
    if (settledRef.current === job.id) return
    settledRef.current = job.id
    if (job.status === 'done') {
      toast.success(`${job.command} finished for ${folder}`)
    } else {
      toast.error(`${job.command} failed (exit ${job.exitCode})`)
    }
    queryClient.invalidateQueries({ queryKey: ['scraper', 'site', folder] })
  }, [job, folder, queryClient])

  const running = job?.status === 'running' || startMutation.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline</CardTitle>
        <CardDescription>
          Runs <code className="rounded bg-muted px-1 py-0.5">pipeline:&lt;command&gt; --brand {folder}</code>{' '}
          on the local server and streams output here.
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
