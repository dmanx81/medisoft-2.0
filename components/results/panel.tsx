'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { LabOrder, LabOrderTest } from '@/features/orders/types';
import type { LabResult, ResultContext } from '@/features/results/types';
import {
  displayRangeBounds,
  displayResultValue,
  flagTone,
  resultFlagLabels,
  resultStatusLabels,
} from '@/features/results/format';
import { stampLabel } from '@/features/orders/format';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function ResultPanel({
  order,
  test,
  results,
  canRead,
  canEnter,
  canValidate,
  canVerify,
  canAmend,
  busy,
  onSave,
  onFailure,
  onBusy,
}: {
  order: LabOrder;
  test: LabOrderTest;
  results: LabResult[];
  canRead: boolean;
  canEnter: boolean;
  canValidate: boolean;
  canVerify: boolean;
  canAmend: boolean;
  busy: boolean;
  onSave: (order: LabOrder) => void;
  onFailure: (failure: Failure | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const current =
    results.find((row) => row.order_test_id === test.id && row.is_current) ??
    null;
  const history = results
    .filter((row) => row.order_test_id === test.id)
    .slice()
    .reverse();
  const eligible =
    (order.status === 'RECEIVED' || order.status === 'IN_PROCESS') &&
    test.status === 'ACTIVE' &&
    test.covering_status === 'RECEIVED';
  const canUpdateEntered =
    canEnter && eligible && (!current || current.status === 'ENTERED');
  const [numericValue, setNumericValue] = useState(current?.numeric_value ?? '');
  const [textValue, setTextValue] = useState(current?.text_value ?? '');
  const [booleanValue, setBooleanValue] = useState(
    current?.boolean_value === 'true'
      ? 'true'
      : current?.boolean_value === 'false'
        ? 'false'
        : '',
  );
  const [reason, setReason] = useState('');
  const [context, setContext] = useState<ResultContext | null>(null);
  useEffect(() => {
    setNumericValue(current?.numeric_value ?? '');
    setTextValue(current?.text_value ?? '');
    setBooleanValue(
      current?.boolean_value === 'true'
        ? 'true'
        : current?.boolean_value === 'false'
          ? 'false'
          : '',
    );
  }, [current?.id, current?.numeric_value, current?.text_value, current?.boolean_value]);
  useEffect(() => {
    if (!canRead || !eligible) return;
    let cancelled = false;
    void fetch(
      `/api/lab-orders/${order.id}/tests/${test.id}/result-context`,
    ).then(async (response) => {
      if (!response.ok || cancelled) return;
      setContext((await response.json()) as ResultContext);
    });
    return () => {
      cancelled = true;
    };
  }, [canRead, eligible, order.id, test.id, current?.id]);
  async function send(url: string, body: unknown) {
    onBusy(true);
    onFailure(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Failure & LabOrder;
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) {
        onFailure(payload);
        return;
      }
      setReason('');
      onSave(payload);
    } catch {
      onFailure({ message: 'The request could not be completed.' });
    } finally {
      onBusy(false);
    }
  }
  const valueBody = {
    numeric_value:
      test.result_type_snapshot === 'NUMERIC' ? numericValue : '',
    text_value:
      test.result_type_snapshot === 'NUMERIC' ||
      test.result_type_snapshot === 'BOOLEAN'
        ? ''
        : textValue,
    boolean_value:
      test.result_type_snapshot === 'BOOLEAN'
        ? booleanValue === 'true'
        : undefined,
  };
  const rangeLabel = current
    ? displayRangeBounds(current)
    : context?.range
      ? displayRangeBounds(context.range)
      : '';
  return (
    <div className="mt-3 grid gap-2 rounded-md bg-mint/40 p-3 text-sm">
      {canRead ? (
        current ? (
          <div>
            <p>
              <span className="font-medium">
                {displayResultValue(current)}
              </span>{' '}
              <span className={flagTone(current.flag)}>
                {resultFlagLabels[current.flag]}
              </span>
              {current.supersedes_id ? (
                <span className="ml-2 rounded border border-line bg-white px-2 py-0.5 text-xs">
                  Amended
                </span>
              ) : null}
            </p>
            <p className="text-xs text-slate">
              {resultStatusLabels[current.status]} · Entered by{' '}
              {current.entered_by_name} {stampLabel(current.entered_at)}
              {current.technically_validated_by_name
                ? ` · Validated by ${current.technically_validated_by_name} ${stampLabel(current.technically_validated_at)}`
                : ''}
              {current.clinically_verified_by_name
                ? ` · Verified by ${current.clinically_verified_by_name} ${stampLabel(current.clinically_verified_at)}`
                : ''}
            </p>
          </div>
        ) : (
          <p className="text-slate">No result entered yet.</p>
        )
      ) : (
        <p className="text-slate">Result values are restricted for this role.</p>
      )}
      {canRead && (
        <p className="text-xs text-slate">
          Reference range:{' '}
          {rangeLabel ||
            context?.range_reason ||
            'No applicable active reference range was selected.'}
        </p>
      )}
      {canUpdateEntered && (
        <form
          className="grid gap-2 md:grid-cols-[minmax(140px,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void send(`/api/lab-orders/${order.id}/tests/${test.id}/results`, {
              ...valueBody,
              version: order.version,
            });
          }}
        >
          {test.result_type_snapshot === 'NUMERIC' && (
            <label className="text-xs font-medium">
              Result ({test.unit_symbol_snapshot || 'numeric'})
              <Input
                className="mt-1"
                value={numericValue}
                onChange={(event) => setNumericValue(event.target.value)}
                inputMode="decimal"
                required
              />
            </label>
          )}
          {test.result_type_snapshot === 'BOOLEAN' && (
            <label className="text-xs font-medium">
              Result
              <NativeSelect
                className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2"
                value={booleanValue}
                onChange={(event) => setBooleanValue(event.target.value)}
                required
              >
                <option value="">Select</option>
                <option value="true">Positive</option>
                <option value="false">Negative</option>
              </NativeSelect>
            </label>
          )}
          {(test.result_type_snapshot === 'TEXT' ||
            test.result_type_snapshot === 'CATEGORICAL') && (
            <label className="text-xs font-medium">
              Result
              <Input
                className="mt-1"
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
                required
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy}
            className="self-end rounded-md bg-teal px-3 py-2 text-white"
          >
            {current ? 'Update result' : 'Save result'}
          </button>
        </form>
      )}
      {canRead && canValidate && current?.status === 'ENTERED' && (
        <button
          type="button"
          disabled={busy}
          className="w-fit rounded-md bg-teal px-3 py-1 text-white"
          onClick={() =>
            void send(`/api/lab-results/${current.id}/validate`, {
              version: current.version,
            })
          }
        >
          Technically validate
        </button>
      )}
      {canRead && canVerify && current?.status === 'TECHNICALLY_VALIDATED' && (
        <button
          type="button"
          disabled={busy}
          className="w-fit rounded-md bg-teal px-3 py-1 text-white"
          onClick={() =>
            void send(`/api/lab-results/${current.id}/verify`, {
              version: current.version,
            })
          }
        >
          Clinically verify
        </button>
      )}
      {canRead && canAmend && current?.status === 'CLINICALLY_VERIFIED' && (
        <form
          className="grid gap-2 rounded-md border border-line bg-white p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(`/api/lab-results/${current.id}/amend`, {
              ...valueBody,
              reason,
              version: current.version,
            });
          }}
        >
          <p className="text-xs font-medium">Amend verified result</p>
          {test.result_type_snapshot === 'NUMERIC' && (
            <Input
              value={numericValue}
              onChange={(event) => setNumericValue(event.target.value)}
              inputMode="decimal"
              required
            />
          )}
          {test.result_type_snapshot === 'BOOLEAN' && (
            <NativeSelect
              className="h-9 w-full rounded-md border border-line bg-white px-2"
              value={booleanValue}
              onChange={(event) => setBooleanValue(event.target.value)}
              required
            >
              <option value="true">Positive</option>
              <option value="false">Negative</option>
            </NativeSelect>
          )}
          {(test.result_type_snapshot === 'TEXT' ||
            test.result_type_snapshot === 'CATEGORICAL') && (
            <Input
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              required
            />
          )}
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Amendment reason"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md border border-coral px-3 py-1 text-coral"
          >
            Save amendment
          </button>
        </form>
      )}
      {canRead && history.length > 1 && (
        <div>
          <h4 className="text-xs font-medium">Result history</h4>
          <ol className="mt-1 grid gap-1 text-xs text-slate">
            {history.map((row) => (
              <li key={row.id}>
                {displayResultValue(row)} · {resultStatusLabels[row.status]} ·{' '}
                {resultFlagLabels[row.flag]}
                {row.amendment_reason ? ` · ${row.amendment_reason}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
