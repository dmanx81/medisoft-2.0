import { Skeleton } from '@/components/ui/skeleton';
export default function DoctorsLoading() {
  return (
    <output className="grid gap-4" aria-label="Loading doctors">
      <span className="sr-only">Loading doctors…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
    </output>
  );
}
