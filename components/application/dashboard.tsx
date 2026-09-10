import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
const labels = [
  'Today’s Patients',
  'New Orders',
  'Pending Results',
  'Awaiting Validation',
  'Completed Today',
];
const statusLabels: Record<string, string> = {
  NEW: 'New',
  COLLECTED: 'Collected',
  PROCESSING: 'Processing',
  AWAITING_VALIDATION: 'Awaiting validation',
  COMPLETED: 'Completed',
};
export function Dashboard({
  demo,
  metrics,
  orders,
}: {
  demo: boolean;
  metrics: number[];
  orders: readonly {
    id: string;
    tests: string;
    time: string;
    status: string;
  }[];
}) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <p className="text-sm font-medium text-teal">Daily overview</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Laboratory dashboard
        </h1>
        <p className="mt-2 text-sm text-slate">
          Orders and laboratory activity at a glance.
        </p>
      </div>
      {demo && (
        <output className="mb-5 block rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Development preview · All figures and orders below are synthetic
          examples.
        </output>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {labels.map((label, i) => (
          <section
            key={label}
            className="rounded-md border border-line bg-white p-4"
          >
            <h2 className="text-sm text-slate">{label}</h2>
            <p className="mt-3 text-3xl font-semibold tabular-nums">
              {metrics[i]}
            </p>
          </section>
        ))}
      </div>
      <section className="mt-6 overflow-hidden rounded-md border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-semibold">Recent Laboratory Orders</h2>
          <p className="mt-1 text-sm text-slate">
            From registration through completion
          </p>
        </div>
        <Table>
          <TableCaption className="pb-4">
            {demo
              ? 'Synthetic development data'
              : 'No laboratory orders have been recorded.'}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Order</TableHead>
              <TableHead>Tests</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="py-4 pl-5 font-medium">
                  {order.id}
                </TableCell>
                <TableCell>{order.tests}</TableCell>
                <TableCell>{order.time}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      order.status === 'COMPLETED'
                        ? 'border-teal/20 bg-mint text-teal'
                        : 'rounded border-line text-slate'
                    }
                  >
                    {statusLabels[order.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {!orders.length && (
              <TableRow>
                <TableCell colSpan={4} className="h-40 text-center">
                  <p className="font-medium">Your workspace is ready</p>
                  <p className="mt-2 text-sm text-slate">
                    Order registration will be available in a future release.
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
