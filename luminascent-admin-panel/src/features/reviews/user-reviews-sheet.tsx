import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { ReviewStatusBadge, Stars, formatDate, formatDateTime } from './review-bits'

type Props = {
  userId: string | null
  onOpenChange: (open: boolean) => void
}

export function UserReviewsSheet({ userId, onOpenChange }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-user-reviews', userId],
    queryFn: () => api.reviews.userProfile(userId!),
    enabled: userId != null,
  })

  return (
    <Sheet open={userId != null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{data?.user.username ?? 'User'}</SheetTitle>
          <SheetDescription>Reviewer profile &amp; history</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          {error ? (
            <p className="text-sm text-destructive">{(error as Error).message}</p>
          ) : isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <dl className="space-y-2 text-sm">
                <Row label="Username" value={data.user.username} />
                <Row label="Email" value={data.user.email} />
                <Row label="User ID" value={<span className="font-mono text-xs">{data.user.id}</span>} />
                <Row label="Joined" value={formatDate(data.user.created_at)} />
              </dl>

              <div className="flex flex-wrap gap-2 text-xs">
                <Stat label="Pending" value={data.stats.pending} />
                <Stat label="Approved" value={data.stats.approved} />
                <Stat label="Rejected" value={data.stats.rejected} />
                <Stat label="Total" value={data.stats.total} />
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Reviews</p>
                {data.reviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reviews yet.</p>
                ) : (
                  data.reviews.map((r) => (
                    <div key={r.id} className="space-y-1 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{r.product_name}</span>
                        <ReviewStatusBadge status={r.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Stars rating={r.rating} />
                        <span className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span>
                      </div>
                      {r.title ? <p className="text-sm font-medium">{r.title}</p> : null}
                      <p className="line-clamp-3 text-sm text-muted-foreground">{r.body}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-1.5">
      <span className="font-semibold">{value}</span> <span className="text-muted-foreground">{label}</span>
    </div>
  )
}
