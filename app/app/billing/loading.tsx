import { Skeleton } from '@/components/ui/skeleton';
export default function BillingLoading() {
  return (
    <output className="grid gap-4" aria-label="Loading laboratory billing">
      <span className="sr-only">Loading laboratory billing…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
    </output>
  );
}
