import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type {
  EnsureBrandResult,
  ImportOptions,
  ImportProductRecord,
  ImportProductResult,
} from '@/lib/types'

const CONCURRENCY = 4

export type ImportItemStatus =
  | 'pending'
  | 'running'
  | 'created'
  | 'updated'
  | 'skipped'
  | 'failed'

export type ImportItemState = {
  index: number
  product: ImportProductRecord
  status: ImportItemStatus
  result?: ImportProductResult
  error?: string
}

export type ImportPhase = 'idle' | 'ensuring-brand' | 'importing' | 'done' | 'cancelled'

export type ImportAggregate = {
  total: number
  completed: number
  created: number
  updated: number
  skipped: number
  failed: number
  imagesAdded: number
  imagesKept: number
  imagesFailed: number
}

type RunImportInput = {
  products: ImportProductRecord[]
  brandName: string
  brandSlug: string
  options: ImportOptions
}

function createAggregate(total: number): ImportAggregate {
  return {
    total,
    completed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    imagesAdded: 0,
    imagesKept: 0,
    imagesFailed: 0,
  }
}

function applyResult(aggregate: ImportAggregate, result: ImportProductResult) {
  aggregate.completed += 1

  if (result.status === 'created') aggregate.created += 1
  if (result.status === 'updated') aggregate.updated += 1
  if (result.status === 'skipped') aggregate.skipped += 1
  if (result.status === 'failed') aggregate.failed += 1

  aggregate.imagesAdded += result.images.added
  aggregate.imagesKept += result.images.kept
  aggregate.imagesFailed += result.images.failed.length
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
) {
  let index = 0

  async function runWorker() {
    while (index < items.length) {
      if (signal?.aborted) return
      const current = index
      index += 1
      await worker(items[current])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  )
}

export function useImportRunner() {
  const [phase, setPhase] = useState<ImportPhase>('idle')
  const [brandResult, setBrandResult] = useState<EnsureBrandResult | null>(null)
  const [items, setItems] = useState<ImportItemState[]>([])
  const [aggregate, setAggregate] = useState<ImportAggregate>(createAggregate(0))
  const abortRef = useRef<AbortController | null>(null)
  const lastInputRef = useRef<RunImportInput | null>(null)

  const updateItem = useCallback((index: number, patch: Partial<ImportItemState>) => {
    setItems((current) =>
      current.map((item) => (item.index === index ? { ...item, ...patch } : item)),
    )
  }, [])

  const importProducts = useCallback(
    async (input: RunImportInput, indices: number[]) => {
      const controller = abortRef.current
      const nextAggregate = createAggregate(indices.length)

      setPhase('importing')

      await runPool(
        indices,
        CONCURRENCY,
        async (itemIndex) => {
          if (controller?.signal.aborted) return

          const product = input.products[itemIndex]
          updateItem(itemIndex, { status: 'running', error: undefined, result: undefined })

          try {
            const { result } = await api.import.importProduct(product, input.options)
            applyResult(nextAggregate, result)

            setAggregate((current) => ({
              ...current,
              completed: nextAggregate.completed,
              created: nextAggregate.created,
              updated: nextAggregate.updated,
              skipped: nextAggregate.skipped,
              failed: nextAggregate.failed,
              imagesAdded: nextAggregate.imagesAdded,
              imagesKept: nextAggregate.imagesKept,
              imagesFailed: nextAggregate.imagesFailed,
            }))

            updateItem(itemIndex, {
              status: result.status,
              result,
              error: result.error,
            })
          } catch (error) {
            nextAggregate.completed += 1
            nextAggregate.failed += 1

            setAggregate((current) => ({
              ...current,
              completed: nextAggregate.completed,
              failed: nextAggregate.failed,
            }))

            updateItem(itemIndex, {
              status: 'failed',
              error: error instanceof Error ? error.message : 'Import failed',
            })
          }
        },
        controller?.signal,
      )

      return nextAggregate
    },
    [updateItem],
  )

  const runImport = useCallback(
    async (input: RunImportInput) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      lastInputRef.current = input

      const initialItems: ImportItemState[] = input.products.map((product, index) => ({
        index,
        product,
        status: 'pending',
      }))

      setItems(initialItems)
      setBrandResult(null)
      setAggregate(createAggregate(input.products.length))
      setPhase('ensuring-brand')

      try {
        const brand = await api.import.ensureBrand({
          name: input.brandName,
          slug: input.brandSlug,
        })

        if (controller.signal.aborted) {
          setPhase('cancelled')
          return
        }

        setBrandResult(brand)

        const summary = await importProducts(
          input,
          input.products.map((_, index) => index),
        )

        if (controller.signal.aborted) {
          setPhase('cancelled')
          return
        }

        setPhase('done')

        toast.success('Import complete', {
          description: [
            `${summary.created} created`,
            `${summary.updated} updated`,
            `${summary.skipped} skipped`,
            `${summary.failed} failed`,
          ].join(', '),
        })
      } catch (error) {
        if (controller.signal.aborted) {
          setPhase('cancelled')
          return
        }

        setPhase('done')
        toast.error(error instanceof Error ? error.message : 'Import failed')
      }
    },
    [importProducts],
  )

  const retryFailed = useCallback(async () => {
    const input = lastInputRef.current
    if (!input) return

    const failedIndices = items
      .filter((item) => item.status === 'failed')
      .map((item) => item.index)

    if (failedIndices.length === 0) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setAggregate(createAggregate(failedIndices.length))

    for (const index of failedIndices) {
      updateItem(index, { status: 'pending', error: undefined, result: undefined })
    }

    const summary = await importProducts(input, failedIndices)

    if (controller.signal.aborted) {
      setPhase('cancelled')
      return
    }

    setPhase('done')
    toast.success('Retry complete', {
      description: [
        `${summary.created} created`,
        `${summary.updated} updated`,
        `${summary.skipped} skipped`,
        `${summary.failed} failed`,
      ].join(', '),
    })
  }, [importProducts, items, updateItem])

  const cancelImport = useCallback(() => {
    abortRef.current?.abort()
    setPhase('cancelled')
    toast.info('Import cancelled')
  }, [])

  const resetImport = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    lastInputRef.current = null
    setPhase('idle')
    setBrandResult(null)
    setItems([])
    setAggregate(createAggregate(0))
  }, [])

  const progress =
    aggregate.total > 0 ? Math.round((aggregate.completed / aggregate.total) * 100) : 0

  return {
    phase,
    brandResult,
    items,
    aggregate,
    progress,
    runImport,
    retryFailed,
    cancelImport,
    resetImport,
    isRunning: phase === 'ensuring-brand' || phase === 'importing',
  }
}
