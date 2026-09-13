import { Skeleton } from '@/components/ui/skeleton';
export default function ReportsLoading() {
  return (
    <output className="grid gap-4" aria-label="Loading laboratory reports">
      <span className="sr-only">Loading laboratory reports…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
    </output>
  );
}
