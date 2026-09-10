'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { LabOrder, LabOrderActivity } from '@/features/orders/types';
import {
  coverageLabel,
  fastingLabels,
  orderActivityLabels,
  orderStatusLabels,
  priorityLabels,
  specimenStatusLabels,
  stampLabel,
} from '@/features/orders/format';
import { specimenLabels } from '@/features/catalogue/format';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function OrderDetail({
  initial,
  activity: initialActivity,
  canEdit,
  canPlace,
  canCancel,
  canCollect,
  canReceive,
  canReject,
}: {
  initial: LabOrder;
  activity: LabOrderActivity[];
  canEdit: boolean;
  canPlace: boolean;
  canCancel: boolean;
  canCollect: boolean;
  canReceive: boolean;
  canReject: boolean;
}) {
  const [order, setOrder] = useState(initial);
  const [activity, setActivity] = useState(initialActivity);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [specimenType, setSpecimenType] = useState('');
  const [linkedTests, setLinkedTests] = useState<string[]>([]);
  const [collectionNotes, setCollectionNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState('');
  const uncovered = useMemo(
    () =>
      order.tests.filter(
        (test) => test.status === 'ACTIVE' && !test.covering_status,
      ),
    [order.tests],
  );
  const compatible = uncovered.filter(
    (test) =>
      !specimenType ||
      test.specimen_type_snapshot === 'OTHER' ||
      test.specimen_type_snapshot === specimenType,
  );
  async function send(url: string, method: string, body: unknown) {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Failure & LabOrder;
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      setOrder(payload);
      const events = await fetch(`/api/lab-orders/${payload.id}/activity`);
      if (events.ok) setActivity((await events.json()) as LabOrderActivity[]);
      setLinkedTests([]);
      setCollectionNotes('');
      setCancelReason('');
      setRejectReason('');
      setRejecting('');
    } catch {
      setFailure({ message: 'The request could not be completed.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-6">
      {failure && (
        <p className="rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {failure.message || 'The action could not be completed.'}
        </p>
      )}
      <section className="grid gap-4 rounded-md border border-line bg-white p-5 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">Patient</h2>
          <p className="mt-2">
            <Link className="text-teal" href={`/app/patients/${order.patient_id}`}>
              {order.patient_first_name} {order.patient_last_name}
            </Link>
          </p>
          <p className="font-mono text-sm text-slate">{order.patient_number}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate">Status</dt>
            <dd>{orderStatusLabels[order.status]}</dd>
          </div>
          <div>
            <dt className="text-slate">Priority</dt>
            <dd className={order.priority === 'URGENT' ? 'text-coral' : ''}>
              {priorityLabels[order.priority]}
            </dd>
          </div>
          <div>
            <dt className="text-slate">Ordered</dt>
            <dd>{stampLabel(order.ordered_at)}</dd>
          </div>
          <div>
            <dt className="text-slate">Ordered by</dt>
            <dd>{order.ordered_by_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate">Physician</dt>
            <dd>{order.ordering_physician_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate">Fasting</dt>
            <dd>{fastingLabels[order.fasting_status]}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-slate">Coverage</dt>
            <dd>{coverageLabel(order.covered_count, order.test_count)}</dd>
          </div>
        </dl>
        {order.clinical_notes && (
          <p className="md:col-span-2 whitespace-pre-wrap text-sm">
            {order.clinical_notes}
          </p>
        )}
        {order.status === 'CANCELLED' && (
          <p className="md:col-span-2 text-sm text-coral">
            Cancelled: {order.cancellation_reason}
          </p>
        )}
      </section>
      <section className="rounded-md border border-line bg-white p-5">
        <h2 className="mb-4 font-semibold">Ordered tests</h2>
        <ul className="divide-y divide-line">
          {order.tests.map((test) => (
            <li key={test.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <span className="font-mono">{test.code_snapshot}</span> {test.name_snapshot}
                <div className="text-xs text-slate">
                  {specimenLabels[test.specimen_type_snapshot]} · {test.result_type_snapshot}
                  {test.unit_symbol_snapshot ? ` · ${test.unit_symbol_snapshot}` : ''}
                  {test.method_snapshot ? ` · ${test.method_snapshot}` : ''}
                  {test.base_price_snapshot ? ` · ${test.base_price_snapshot}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span>
                  {test.covering_status
                    ? specimenStatusLabels[test.covering_status]
                    : test.status === 'CANCELLED'
                      ? 'Cancelled'
                      : 'Uncollected'}
                </span>
                {canEdit && order.status === 'DRAFT' && (
                  <button
                    type="button"
                    className="text-coral"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        `/api/lab-orders/${order.id}/tests/${test.id}`,
                        'DELETE',
                        { version: order.version },
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-md border border-line bg-white p-5">
        <h2 className="mb-4 font-semibold">Specimens</h2>
        {order.specimens.length === 0 ? (
          <p className="text-sm text-slate">No specimens collected yet.</p>
        ) : (
          <ul className="grid gap-3">
            {order.specimens.map((specimen) => (
              <li key={specimen.id} className="rounded-md border border-line p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <span className="font-mono">{specimen.accession_number}</span>{' '}
                    {specimenLabels[specimen.specimen_type]} ·{' '}
                    {specimenStatusLabels[specimen.status]}
                  </p>
                  <div className="flex gap-2">
                    {canReceive && specimen.status === 'COLLECTED' && (
                      <button
                        type="button"
                        className="rounded-md bg-teal px-3 py-1 text-white"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            `/api/lab-specimens/${specimen.id}/receive`,
                            'POST',
                            { version: specimen.version },
                          )
                        }
                      >
                        Receive
                      </button>
                    )}
                    {canReject &&
                      (specimen.status === 'COLLECTED' ||
                        specimen.status === 'RECEIVED') && (
                        <button
                          type="button"
                          className="rounded-md border border-coral px-3 py-1 text-coral"
                          disabled={busy}
                          onClick={() => setRejecting(specimen.id)}
                        >
                          Reject
                        </button>
                      )}
                  </div>
                </div>
                <p className="mt-2 text-slate">
                  Collected {stampLabel(specimen.collected_at)} by {specimen.collected_by_name}
                  {specimen.received_at
                    ? ` · Received ${stampLabel(specimen.received_at)} by ${specimen.received_by_name}`
                    : ''}
                </p>
                <p className="mt-1">
                  Linked tests:{' '}
                  {order.tests
                    .filter((test) => specimen.order_test_ids.includes(test.id))
                    .map((test) => test.code_snapshot)
                    .join(', ') || 'None'}
                </p>
                {specimen.status === 'REJECTED' && (
                  <p className="mt-1 text-coral">
                    Rejected: {specimen.rejection_reason}
                  </p>
                )}
                {rejecting === specimen.id && (
                  <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send(
                        `/api/lab-specimens/${specimen.id}/reject`,
                        'POST',
                        { version: specimen.version, reason: rejectReason },
                      );
                    }}
                  >
                    <Input
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      placeholder="Rejection reason"
                      required
                    />
                    <button className="rounded-md bg-coral px-3 py-1 text-white" type="submit">
                      Confirm rejection
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {canCollect &&
          ['ORDERED', 'PARTIALLY_COLLECTED', 'COLLECTED'].includes(order.status) &&
          uncovered.length > 0 && (
            <form
              className="mt-5 grid gap-3 rounded-md bg-mint p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void send(`/api/lab-orders/${order.id}/specimens`, 'POST', {
                  specimen_type: specimenType,
                  order_test_ids: linkedTests,
                  collection_notes: collectionNotes,
                  version: order.version,
                });
              }}
            >
              <h3 className="font-medium">Collect specimen</h3>
              <label className="text-sm font-medium" htmlFor="specimen-type">
                Specimen type
                <NativeSelect
                  id="specimen-type"
                  required
                  className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
                  value={specimenType}
                  onChange={(event) => {
                    setSpecimenType(event.target.value);
                    setLinkedTests([]);
                  }}
                >
                  <option value="">Select type</option>
                  {[...new Set(uncovered.map((test) => test.specimen_type_snapshot))].map(
                    (type) => (
                      <option key={type} value={type}>
                        {specimenLabels[type]}
                      </option>
                    ),
                  )}
                </NativeSelect>
              </label>
              <fieldset>
                <legend className="text-sm font-medium">Satisfies tests</legend>
                <div className="mt-2 grid gap-2">
                  {compatible.map((test) => (
                    <label key={test.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={linkedTests.includes(test.id)}
                        onChange={(event) =>
                          setLinkedTests((current) =>
                            event.target.checked
                              ? [...current, test.id]
                              : current.filter((id) => id !== test.id),
                          )
                        }
                      />
                      {test.code_snapshot} {test.name_snapshot}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="text-sm font-medium" htmlFor="collection-notes">
                Collection notes
                <Input
                  id="collection-notes"
                  value={collectionNotes}
                  onChange={(event) => setCollectionNotes(event.target.value)}
                  className="mt-2"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
              >
                Save collection
              </button>
            </form>
          )}
      </section>
      {(canPlace && order.status === 'DRAFT') ||
      (canCancel && (order.status === 'DRAFT' || order.status === 'ORDERED')) ? (
        <section className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-5">
          {canPlace && order.status === 'DRAFT' && (
            <button
              type="button"
              disabled={busy}
              className="rounded-md bg-teal px-4 py-2 text-sm text-white"
              onClick={() =>
                void send(`/api/lab-orders/${order.id}/place`, 'POST', {
                  version: order.version,
                })
              }
            >
              Place order
            </button>
          )}
          {canCancel &&
            (order.status === 'DRAFT' || order.status === 'ORDERED') && (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(`/api/lab-orders/${order.id}/cancel`, 'POST', {
                    version: order.version,
                    reason: cancelReason,
                  });
                }}
              >
                <Input
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Cancellation reason"
                  required
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md border border-coral px-4 py-2 text-sm text-coral"
                >
                  Cancel order
                </button>
              </form>
            )}
        </section>
      ) : null}
      <section className="rounded-md border border-line bg-white p-5">
        <h2 className="mb-4 font-semibold">Activity</h2>
        <ol className="grid gap-3 text-sm">
          {activity.map((event) => (
            <li key={event.id}>
              <span className="font-medium">
                {orderActivityLabels[event.action] || event.action}
              </span>
              <span className="text-slate">
                {' '}
                · {event.actor} · {stampLabel(event.occurred_at)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
