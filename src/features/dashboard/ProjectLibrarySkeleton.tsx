import { Skeleton } from '@/components/ui/skeleton';

export function ProjectLibrarySkeleton({ label = 'Loading projects…' }: { label?: string }) {
  return <div role="status" aria-live="polite" data-project-library-skeleton>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="grid gap-3">
      {[0, 1, 2].map(row => <div className="grid grid-cols-[32px_minmax(0,1fr)_48px] items-center gap-3 py-3" key={row}>
        <Skeleton className="size-8" />
        <div className="grid gap-2"><Skeleton className="h-3 w-2/5" /><Skeleton className="h-2 w-1/4" /></div>
        <Skeleton className="h-6 w-12" />
      </div>)}
    </div>
  </div>;
}
