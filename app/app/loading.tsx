import { Skeleton } from '@/components/ui/skeleton';
export default function Loading() {
  return (
    <output aria-label="Loading workspace" className="grid gap-4">
      <span className="sr-only">Loading workspace…</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </output>
  );
}
