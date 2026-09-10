import { Skeleton } from '@/components/ui/skeleton';
export default function PatientLoading() {
  return (
    <output className="grid gap-4" aria-label="Loading patient records">
      <span className="sr-only">Loading patient records…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
    </output>
  );
}
