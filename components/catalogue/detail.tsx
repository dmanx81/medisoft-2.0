'use client';
import { useMemo, useRef, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type {
  CatalogueLookups,
  LabRange,
  LabTest,
} from '@/features/catalogue/types';
import {
  emptyRange,
  fieldErrors,
  rangeSchema,
  rangeSexes,
  ageUnits,
  lowerOperators,
  upperOperators,
  type RangeInput,
} from '@/features/catalogue/validation';
import {
  ageBand,
  compactNumber,
  rangeText,
  resultTypeLabels,
  sexLabels,
  specimenLabels,
  stampLabel,
} from '@/features/catalogue/format';
type SaveError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};
export function CatalogueDetail({
  test,
  ranges,
  lookups,
  canEdit,
}: {
  test: LabTest;
  ranges: LabRange[];
  lookups: CatalogueLookups;
  canEdit: boolean;
}) {
  const lock = useRef(false);
  const [rows, setRows] = useState(ranges);
  const [values, setValues] = useState<RangeInput>({
    ...emptyRange,
    unit_id: test.unit_id,
    method: test.method,
  });
  const [replacing, setReplacing] = useState<LabRange | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<SaveError | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const activeCount = useMemo(
    () => rows.filter((range) => range.is_active).length,
    [rows],
  );
  function change<K extends keyof RangeInput>(name: K, value: RangeInput[K]) {
    setValues((current) => ({ ...current, [name]: value }));
    setFailure(null);
    setErrors((current) => ({ ...current, [name]: '' }));
  }
  function startReplace(range: LabRange) {
    setReplacing(range);
    setConfirmRetire(null);
    setValues({
      sex: range.sex,
      age_min: range.age_min,
      age_max: range.age_max,
      age_unit: range.age_unit,
      lower_bound: range.lower_bound,
      upper_bound: range.upper_bound,
      lower_operator: range.lower_operator,
      upper_operator: range.upper_operator,
      text_range: range.text_range,
      unit_id: range.unit_id,
      method: range.method,
      critical_low: range.critical_low,
      critical_high: range.critical_high,
      valid_from: '',
    });
    setFailure(null);
    setErrors({});
  }
  async function submitRange() {
    if (lock.current) return;
    const parsed = rangeSchema.safeParse(values);
    if (!parsed.success) {
      const next = fieldErrors(parsed.error);
      setErrors(next);
      setFailure({
        code: 'VALIDATION',
        message: 'Check the highlighted range fields.',
      });
      return;
    }
    lock.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch(
        replacing
          ? `/api/tests/${test.id}/ranges/${replacing.id}/replace`
          : `/api/tests/${test.id}/ranges`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: parsed.data,
            ...(replacing ? { version: replacing.version } : {}),
          }),
          cache: 'no-store',
        },
      );
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) {
        const problem: SaveError = await response.json();
        setFailure(problem);
        setErrors(problem.fields ?? {});
        return;
      }
      const body = await response.json();
      if (replacing) {
        const result = body as { previous: LabRange; current: LabRange };
        setRows((current) => [
          result.current,
          ...current.map((range) =>
            range.id === result.previous.id ? result.previous : range,
          ),
        ]);
      } else {
        setRows((current) => [body as LabRange, ...current]);
      }
      setReplacing(null);
      setValues({
        ...emptyRange,
        unit_id: test.unit_id,
        method: test.method,
      });
    } catch {
      setFailure({
        code: 'UNAVAILABLE',
        message: 'The range could not be saved. Try again.',
      });
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function retire(range: LabRange) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch(
        `/api/tests/${test.id}/ranges/${range.id}/retire`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: range.version }),
          cache: 'no-store',
        },
      );
      if (!response.ok) {
        const problem: SaveError = await response.json();
        setFailure(problem);
        return;
      }
      const updated: LabRange = await response.json();
      setRows((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setConfirmRetire(null);
      if (replacing?.id === range.id) setReplacing(null);
    } catch {
      setFailure({
        code: 'UNAVAILABLE',
        message: 'The range could not be retired. Try again.',
      });
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function toggleStatus() {
    setStatusBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/tests/${test.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: test.version,
          data: {
            code: test.code,
            name: test.name,
            short_name: test.short_name,
            category_id: test.category_id,
            description: test.description,
            specimen_type: test.specimen_type,
            result_type: test.result_type,
            unit_id: test.unit_id,
            method: test.method,
            display_order: Number(test.display_order),
            base_price: test.base_price,
            is_active: !test.is_active,
          },
        }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const problem: SaveError = await response.json();
        setFailure(problem);
        return;
      }
      window.location.assign(`/app/management/tests/${test.id}?saved=1`);
    } catch {
      setFailure({
        code: 'UNAVAILABLE',
        message: 'Status could not be updated. Try again.',
      });
    } finally {
      setStatusBusy(false);
    }
  }
  const facts = [
    ['Code', test.code],
    ['Category', test.category_name],
    ['Specimen', specimenLabels[test.specimen_type] ?? test.specimen_type],
    ['Result type', resultTypeLabels[test.result_type] ?? test.result_type],
    ['Unit', test.unit_symbol || '—'],
    ['Method', test.method || '—'],
    ['Base price', test.base_price || 'Not set'],
    ['Short name', test.short_name || '—'],
  ];
  return (
    <div className="grid gap-6">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={statusBusy}
            onClick={() => void toggleStatus()}
            className="rounded border border-line bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            {statusBusy
              ? 'Updating…'
              : test.is_active
                ? 'Deactivate test'
                : 'Activate test'}
          </button>
        </div>
      )}
      <section className="rounded-md border border-line bg-white p-5">
        <h2 className="mb-4 font-semibold">Definition</h2>
        <dl className="grid gap-3 md:grid-cols-2">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[minmax(110px,140px)_1fr] gap-3 text-sm"
            >
              <dt className="text-slate">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {test.description ? (
          <p className="mt-4 whitespace-pre-wrap text-sm">{test.description}</p>
        ) : null}
      </section>
      <section className="rounded-md border border-line bg-white p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Reference ranges</h2>
          <p className="text-sm text-slate">
            {activeCount} current · {rows.length} including history
          </p>
        </div>
        <p className="mb-4 text-sm text-slate">
          Ranges are retired or replaced, never overwritten. Historical bounds
          remain available for later result snapshots.
        </p>
        {failure && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            {failure.message}
          </div>
        )}
        {canEdit && (
          <form
            className="mb-5 grid gap-3 rounded border border-line p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRange();
            }}
          >
            <h3 className="text-sm font-semibold">
              {replacing
                ? `Replace range ${replacing.sex} v${replacing.range_version}`
                : 'Add reference range'}
            </h3>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label htmlFor="range-sex" className="text-sm font-medium">
                  Sex
                </label>
                <NativeSelect
                  id="range-sex"
                  className="mt-1 w-full"
                  value={values.sex}
                  onChange={(event) =>
                    change('sex', event.target.value as RangeInput['sex'])
                  }
                >
                  {rangeSexes.map((sex) => (
                    <NativeSelectOption key={sex} value={sex}>
                      {sexLabels[sex]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="range-age-min" className="text-sm font-medium">
                  Age min
                </label>
                <Input
                  id="range-age-min"
                  className="mt-1"
                  value={values.age_min}
                  onChange={(event) => change('age_min', event.target.value)}
                  aria-invalid={!!errors.age_min}
                />
              </div>
              <div>
                <label htmlFor="range-age-max" className="text-sm font-medium">
                  Age max
                </label>
                <Input
                  id="range-age-max"
                  className="mt-1"
                  value={values.age_max}
                  onChange={(event) => change('age_max', event.target.value)}
                  aria-invalid={!!errors.age_max}
                />
              </div>
              <div>
                <label htmlFor="range-age-unit" className="text-sm font-medium">
                  Age unit
                </label>
                <NativeSelect
                  id="range-age-unit"
                  className="mt-1 w-full"
                  value={values.age_unit}
                  onChange={(event) =>
                    change(
                      'age_unit',
                      event.target.value as RangeInput['age_unit'],
                    )
                  }
                >
                  {ageUnits.map((unit) => (
                    <NativeSelectOption key={unit} value={unit}>
                      {unit.toLowerCase()}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="range-lower" className="text-sm font-medium">
                  Lower
                </label>
                <div className="mt-1 flex gap-2">
                  <NativeSelect
                    id="range-lower-op"
                    aria-label="Lower operator"
                    className="min-w-16"
                    value={values.lower_operator}
                    onChange={(event) =>
                      change(
                        'lower_operator',
                        event.target.value as RangeInput['lower_operator'],
                      )
                    }
                  >
                    {lowerOperators.map((operator) => (
                      <NativeSelectOption key={operator} value={operator}>
                        {operator === 'GE' ? '≥' : '>'}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    id="range-lower"
                    value={values.lower_bound}
                    onChange={(event) =>
                      change('lower_bound', event.target.value)
                    }
                    aria-invalid={!!errors.lower_bound}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="range-upper" className="text-sm font-medium">
                  Upper
                </label>
                <div className="mt-1 flex gap-2">
                  <NativeSelect
                    id="range-upper-op"
                    aria-label="Upper operator"
                    className="min-w-16"
                    value={values.upper_operator}
                    onChange={(event) =>
                      change(
                        'upper_operator',
                        event.target.value as RangeInput['upper_operator'],
                      )
                    }
                  >
                    {upperOperators.map((operator) => (
                      <NativeSelectOption key={operator} value={operator}>
                        {operator === 'LE' ? '≤' : '<'}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    id="range-upper"
                    value={values.upper_bound}
                    onChange={(event) =>
                      change('upper_bound', event.target.value)
                    }
                    aria-invalid={!!errors.upper_bound}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="range-critical-low" className="text-sm font-medium">
                  Critical low
                </label>
                <Input
                  id="range-critical-low"
                  className="mt-1"
                  value={values.critical_low}
                  onChange={(event) =>
                    change('critical_low', event.target.value)
                  }
                  aria-invalid={!!errors.critical_low}
                />
              </div>
              <div>
                <label htmlFor="range-critical-high" className="text-sm font-medium">
                  Critical high
                </label>
                <Input
                  id="range-critical-high"
                  className="mt-1"
                  value={values.critical_high}
                  onChange={(event) =>
                    change('critical_high', event.target.value)
                  }
                  aria-invalid={!!errors.critical_high}
                />
              </div>
              <div>
                <label htmlFor="range-unit" className="text-sm font-medium">
                  Unit
                </label>
                <NativeSelect
                  id="range-unit"
                  className="mt-1 w-full"
                  value={values.unit_id}
                  onChange={(event) => change('unit_id', event.target.value)}
                >
                  <NativeSelectOption value="">Test default</NativeSelectOption>
                  {lookups.units.map((unit) => (
                    <NativeSelectOption key={unit.id} value={unit.id}>
                      {unit.symbol}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="range-method" className="text-sm font-medium">
                  Method
                </label>
                <Input
                  id="range-method"
                  className="mt-1"
                  value={values.method}
                  onChange={(event) => change('method', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="range-text" className="text-sm font-medium">
                  Text range
                </label>
                <Input
                  id="range-text"
                  className="mt-1"
                  value={values.text_range}
                  onChange={(event) => change('text_range', event.target.value)}
                  aria-invalid={!!errors.text_range}
                />
              </div>
            </div>
            {Object.values(errors).some(Boolean) && (
              <ul className="text-sm text-red-700">
                {Object.entries(errors)
                  .filter(([, message]) => message)
                  .map(([field, message]) => (
                    <li key={field}>{message}</li>
                  ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={saving}
                type="submit"
                className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving
                  ? 'Saving…'
                  : replacing
                    ? 'Save replacement'
                    : 'Add range'}
              </button>
              {replacing && (
                <button
                  type="button"
                  className="rounded border border-line px-4 py-2 text-sm"
                  onClick={() => {
                    setReplacing(null);
                    setValues({
                      ...emptyRange,
                      unit_id: test.unit_id,
                      method: test.method,
                    });
                  }}
                >
                  Cancel replacement
                </button>
              )}
            </div>
          </form>
        )}
        <div className="overflow-hidden rounded border border-line">
          <Table>
            <caption className="sr-only">Reference ranges</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Sex</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Range</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((range) => (
                <TableRow key={range.id}>
                  <TableCell className="py-3 pl-4">
                    {sexLabels[range.sex]}
                    <span className="block font-mono text-[11px] text-slate">
                      v{range.range_version}
                    </span>
                  </TableCell>
                  <TableCell>{ageBand(range)}</TableCell>
                  <TableCell>
                    {rangeText(range)}
                    {range.critical_low || range.critical_high ? (
                      <span className="block text-xs text-slate">
                        Critical {compactNumber(range.critical_low) || '—'}–
                        {compactNumber(range.critical_high) || '—'}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{range.unit_symbol || test.unit_symbol || '—'}</TableCell>
                  <TableCell className="text-xs">
                    {stampLabel(range.valid_from)}
                    {range.valid_to ? ` → ${stampLabel(range.valid_to)}` : ' → current'}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded border px-2 py-1 text-xs ${range.is_active ? 'border-teal/20 bg-mint text-teal' : 'border-line text-slate'}`}
                    >
                      {range.is_active ? 'Current' : 'Retired'}
                    </span>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      {range.is_active ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-sm text-teal underline"
                            onClick={() => startReplace(range)}
                          >
                            Replace
                          </button>
                          {confirmRetire === range.id ? (
                            <button
                              type="button"
                              className="text-sm text-red-800 underline"
                              disabled={saving}
                              onClick={() => void retire(range)}
                            >
                              Confirm retire
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-sm underline"
                              onClick={() => setConfirmRetire(range.id)}
                            >
                              Retire
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate">Preserved</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 7 : 6} className="h-24 text-center">
                    No reference ranges recorded for this test.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
