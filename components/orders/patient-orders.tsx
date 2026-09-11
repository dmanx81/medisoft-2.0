'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { LabOrderPage } from '@/features/orders/types';
import { orderStatusLabels, stampLabel } from '@/features/orders/format';
export function PatientOrders({
  patientId,
  canCreate,
}: {
  patientId: string;
  canCreate: boolean;
}) {
  const [result, setResult] = useState<LabOrderPage | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/lab-orders/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, pageSize: 20 }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('unavailable');
        const data = (await response.json()) as LabOrderPage;
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setError('Laboratory orders could not be loaded.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);
  return (
    <div className="rounded-md border border-line bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">Laboratory orders</h2>
        {canCreate && (
          <Link
            className="text-sm text-teal"
            href="/app/laboratory/orders/new"
          >
            New order
          </Link>
        )}
      </div>
      {error && <p className="text-sm text-coral">{error}</p>}
      {result && result.orders.length === 0 && (
        <p className="text-sm text-slate">No laboratory orders for this patient.</p>
      )}
      {result && result.orders.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {result.orders.map((order) => (
            <li key={order.id} className="flex justify-between py-2">
              <Link className="font-mono text-teal" href={`/app/laboratory/orders/${order.id}`}>
                {order.order_number}
              </Link>
              <span>
                {orderStatusLabels[order.status]} · {stampLabel(order.ordered_at || order.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
