import { Skeleton } from '@/components/ui/skeleton';
export default function OrdersLoading() {
  return (
    <output className="grid gap-4" aria-label="Loading laboratory orders">
      <span className="sr-only">Loading laboratory orders…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
    </output>
  );
}
