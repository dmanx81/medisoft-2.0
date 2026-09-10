'use client';
import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  catalogueSchema,
  emptyTest,
  fieldErrors,
  specimenTypes,
  resultTypes,
  type CatalogueInput,
} from '@/features/catalogue/validation';
import type {
  CatalogueLookups,
  LabCategory,
  LabTest,
  LabUnit,
} from '@/features/catalogue/types';
import {
  resultTypeLabels,
  specimenLabels,
} from '@/features/catalogue/format';
type SaveError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};
export function CatalogueForm({
  initial,
  lookups,
}: {
  initial?: LabTest;
  lookups: CatalogueLookups;
}) {
  const router = useRouter();
  const lock = useRef(false);
  const [values, setValues] = useState<CatalogueInput>(() =>
    initial
      ? {
          code: initial.code,
          name: initial.name,
          short_name: initial.short_name,
          category_id: initial.category_id,
          description: initial.description,
          specimen_type: initial.specimen_type,
          result_type: initial.result_type,
          unit_id: initial.unit_id,
          method: initial.method,
          display_order: Number(initial.display_order),
          base_price: initial.base_price,
          is_active: initial.is_active,
        }
      : emptyTest,
  );
  const [categories, setCategories] = useState(lookups.categories);
  const [units, setUnits] = useState(lookups.units);
  const [newCategory, setNewCategory] = useState({ code: '', name: '' });
  const [newUnit, setNewUnit] = useState({ symbol: '', name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<SaveError | null>(null);
  const [saving, setSaving] = useState(false);
  function change<K extends keyof CatalogueInput>(
    name: K,
    value: CatalogueInput[K],
  ) {
    setValues((current) => ({ ...current, [name]: value }));
    setFailure(null);
    setErrors((current) => ({ ...current, [name]: '' }));
  }
  async function addCategory() {
    const response = await fetch('/api/tests/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCategory),
      cache: 'no-store',
    });
    const body = (await response.json()) as SaveError & Partial<LabCategory>;
    if (!response.ok) {
      setFailure({
        code: body.code ?? 'VALIDATION',
        message: body.message ?? 'Category could not be created.',
        fields: body.fields,
      });
      return;
    }
    const category = body as LabCategory;
    setCategories((current) =>
      [...current, category].sort((a, b) => a.name.localeCompare(b.name)),
    );
    change('category_id', category.id);
    setNewCategory({ code: '', name: '' });
  }
  async function addUnit() {
    const response = await fetch('/api/tests/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUnit),
      cache: 'no-store',
    });
    const body = (await response.json()) as SaveError & Partial<LabUnit>;
    if (!response.ok) {
      setFailure({
        code: body.code ?? 'VALIDATION',
        message: body.message ?? 'Unit could not be created.',
        fields: body.fields,
      });
      return;
    }
    const unit = body as LabUnit;
    setUnits((current) =>
      [...current, unit].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    );
    change('unit_id', unit.id);
    setNewUnit({ symbol: '', name: '' });
  }
  async function save() {
    if (lock.current) return;
    const parsed = catalogueSchema.safeParse({
      ...values,
      display_order: Number(values.display_order),
    });
    if (!parsed.success) {
      const next = fieldErrors(parsed.error);
      setErrors(next);
      setFailure({
        code: 'VALIDATION',
        message: 'Check the highlighted fields.',
      });
      document.getElementById(`test-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    lock.current = true;
    setSaving(true);
    setErrors({});
    setFailure(null);
    try {
      const response = await fetch(
        initial ? `/api/tests/${initial.id}` : '/api/tests',
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: parsed.data,
            ...(initial ? { version: initial.version } : {}),
          }),
          cache: 'no-store',
        },
      );
      if (response.status === 401) {
        setFailure({
          code: 'UNAUTHENTICATED',
          message:
            'Your session expired. Sign in in another tab, then return here to save.',
        });
        return;
      }
      if (!response.ok) {
        const problem: SaveError = await response.json();
        setFailure(problem);
        setErrors(problem.fields ?? {});
        return;
      }
      const test: LabTest = await response.json();
      router.push(`/app/management/tests/${test.id}?saved=1`);
      router.refresh();
    } catch {
      setFailure({
        code: 'UNAVAILABLE',
        message: 'The save could not be confirmed. Inspect the catalogue before retrying.',
      });
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="grid gap-5"
    >
      {failure && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <p className="font-medium">{failure.message}</p>
          {failure.code === 'STALE_VERSION' && (
            <a
              className="mt-2 inline-block underline"
              href={`/app/management/tests/${initial?.id}/edit`}
            >
              Reload the latest record (unsaved changes will be lost)
            </a>
          )}
          {failure.code === 'UNAUTHENTICATED' && (
            <a
              href="/login"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block underline"
            >
              Sign in
            </a>
          )}
        </div>
      )}
      <fieldset disabled={saving} className="contents">
        <section className="rounded-md border border-line bg-white p-5">
          <h2 className="mb-4 font-semibold">Identity</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="test-code"
              label="Code"
              required
              error={errors.code}
              hint="Unique within this organization."
            >
              <Input
                id="test-code"
                value={values.code}
                onChange={(event) =>
                  change('code', event.target.value.toUpperCase())
                }
                maxLength={32}
                aria-invalid={!!errors.code}
              />
            </Field>
            <Field id="test-name" label="Name" required error={errors.name}>
              <Input
                id="test-name"
                value={values.name}
                onChange={(event) => change('name', event.target.value)}
                maxLength={160}
                aria-invalid={!!errors.name}
              />
            </Field>
            <Field id="test-short_name" label="Short name" error={errors.short_name}>
              <Input
                id="test-short_name"
                value={values.short_name}
                onChange={(event) => change('short_name', event.target.value)}
                maxLength={40}
              />
            </Field>
            <Field
              id="test-category_id"
              label="Category"
              required
              error={errors.category_id}
            >
              <NativeSelect
                id="test-category_id"
                className="w-full"
                value={values.category_id}
                onChange={(event) => change('category_id', event.target.value)}
                aria-invalid={!!errors.category_id}
              >
                <NativeSelectOption value="">Select category</NativeSelectOption>
                {categories.map((category) => (
                  <NativeSelectOption key={category.id} value={category.id}>
                    {category.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="mt-4 grid gap-3 rounded border border-dashed border-line p-3 md:grid-cols-[140px_1fr_auto]">
            <Input
              aria-label="New category code"
              placeholder="BIOCHEM"
              value={newCategory.code}
              onChange={(event) =>
                setNewCategory((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
            />
            <Input
              aria-label="New category name"
              placeholder="Add a category name"
              value={newCategory.name}
              onChange={(event) =>
                setNewCategory((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <button
              type="button"
              className="rounded border border-line px-3 py-2 text-sm"
              onClick={() => void addCategory()}
            >
              Add category
            </button>
          </div>
        </section>
        <section className="rounded-md border border-line bg-white p-5">
          <h2 className="mb-4 font-semibold">Laboratory definition</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="test-specimen_type"
              label="Specimen"
              required
              error={errors.specimen_type}
            >
              <NativeSelect
                id="test-specimen_type"
                className="w-full"
                value={values.specimen_type}
                onChange={(event) =>
                  change(
                    'specimen_type',
                    event.target.value as CatalogueInput['specimen_type'],
                  )
                }
              >
                {specimenTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {specimenLabels[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="test-result_type"
              label="Result type"
              required
              error={errors.result_type}
            >
              <NativeSelect
                id="test-result_type"
                className="w-full"
                value={values.result_type}
                onChange={(event) =>
                  change(
                    'result_type',
                    event.target.value as CatalogueInput['result_type'],
                  )
                }
              >
                {resultTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {resultTypeLabels[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id="test-unit_id" label="Default unit" error={errors.unit_id}>
              <NativeSelect
                id="test-unit_id"
                className="w-full"
                value={values.unit_id}
                onChange={(event) => change('unit_id', event.target.value)}
                aria-invalid={!!errors.unit_id}
              >
                <NativeSelectOption value="">No unit</NativeSelectOption>
                {units.map((unit) => (
                  <NativeSelectOption key={unit.id} value={unit.id}>
                    {unit.symbol} · {unit.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id="test-method" label="Method" error={errors.method}>
              <Input
                id="test-method"
                value={values.method}
                onChange={(event) => change('method', event.target.value)}
                maxLength={120}
              />
            </Field>
            <Field
              id="test-display_order"
              label="Display order"
              error={errors.display_order}
            >
              <Input
                id="test-display_order"
                type="number"
                min={0}
                max={1000000}
                value={values.display_order}
                onChange={(event) =>
                  change('display_order', Number(event.target.value || 0))
                }
              />
            </Field>
            <Field
              id="test-base_price"
              label="Base price"
              error={errors.base_price}
              hint="Optional list price. Billing is not implemented in this phase."
            >
              <Input
                id="test-base_price"
                inputMode="decimal"
                value={values.base_price}
                onChange={(event) => change('base_price', event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-3 rounded border border-dashed border-line p-3 md:grid-cols-[140px_1fr_auto]">
            <Input
              aria-label="New unit symbol"
              placeholder="µIU/mL"
              value={newUnit.symbol}
              onChange={(event) =>
                setNewUnit((current) => ({
                  ...current,
                  symbol: event.target.value,
                }))
              }
            />
            <Input
              aria-label="New unit name"
              placeholder="Add a unit name"
              value={newUnit.name}
              onChange={(event) =>
                setNewUnit((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <button
              type="button"
              className="rounded border border-line px-3 py-2 text-sm"
              onClick={() => void addUnit()}
            >
              Add unit
            </button>
          </div>
        </section>
        <section className="rounded-md border border-line bg-white p-5">
          <h2 className="mb-4 font-semibold">Status and notes</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="test-is_active" label="Status" error={errors.is_active}>
              <NativeSelect
                id="test-is_active"
                className="w-full"
                value={values.is_active ? 'ACTIVE' : 'INACTIVE'}
                onChange={(event) =>
                  change('is_active', event.target.value === 'ACTIVE')
                }
              >
                <NativeSelectOption value="ACTIVE">Active</NativeSelectOption>
                <NativeSelectOption value="INACTIVE">Inactive</NativeSelectOption>
              </NativeSelect>
            </Field>
            <div className="md:col-span-2">
              <Field
                id="test-description"
                label="Description"
                error={errors.description}
              >
                <Textarea
                  id="test-description"
                  rows={3}
                  maxLength={2000}
                  value={values.description}
                  onChange={(event) =>
                    change('description', event.target.value)
                  }
                />
              </Field>
            </div>
          </div>
        </section>
      </fieldset>
      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-md border border-line bg-white p-4">
        <Link
          href={
            initial
              ? `/app/management/tests/${initial.id}`
              : '/app/management/tests'
          }
          className="text-sm text-slate underline"
        >
          Cancel
        </Link>
        <button
          disabled={saving}
          type="submit"
          className="rounded-md bg-teal px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create test'}
        </button>
      </div>
    </form>
  );
}
function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        {label}
        {required ? ' *' : ''}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
