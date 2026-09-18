'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import type {
  PrescriptionItemInput,
  PrescriptionTemplate,
} from '@/features/clinical/types';
const emptyLine: PrescriptionItemInput = {
  medication_name: '',
  strength: '',
  form: '',
  dose: '',
  route: '',
  frequency: '',
  duration: '',
  quantity: '',
  instructions: '',
};
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function TemplateForm({ initial }: { initial?: PrescriptionTemplate }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [category, setCategory] = useState(initial?.category || '');
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [items, setItems] = useState<PrescriptionItemInput[]>(
    initial?.items.length
      ? initial.items.map(({ id: _id, sort_order: _order, ...item }) => item)
      : [{ ...emptyLine }],
  );
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function changeItem(
    index: number,
    field: keyof PrescriptionItemInput,
    value: string,
  ) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  }
  function moveItem(index: number, direction: -1 | 1) {
    setItems((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row);
      return next;
    });
  }
  async function save() {
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch(
        initial
          ? `/api/prescription-templates/${initial.id}`
          : '/api/prescription-templates',
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description,
            category,
            is_active: active,
            items: items.filter((item) => item.medication_name.trim()),
            version: initial?.version,
          }),
          cache: 'no-store',
        },
      );
      const payload = (await response.json()) as Failure & PrescriptionTemplate;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      router.push(`/app/prescription-templates/${payload.id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }
  async function duplicate() {
    if (!initial) return;
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch(
        `/api/prescription-templates/${initial.id}/duplicate`,
        { method: 'POST', cache: 'no-store' },
      );
      const payload = (await response.json()) as Failure & PrescriptionTemplate;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      router.push(`/app/prescription-templates/${payload.id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!initial) return;
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/prescription-templates/${initial.id}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      if (!response.ok) {
        setFailure((await response.json()) as Failure);
        return;
      }
      router.push('/app/prescription-templates');
      router.refresh();
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {failure && (
        <p className="rounded-md border border-coral/30 p-3 text-sm text-coral" role="alert">
          {failure.message || 'The template could not be saved.'}
        </p>
      )}
      <label className="text-sm font-medium" htmlFor="template-name">
        Template name
        <Input
          id="template-name"
          className="mt-2"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="text-sm font-medium" htmlFor="template-category">
        Category
        <Input
          id="template-category"
          className="mt-2"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="For example ENT or Paediatrics"
        />
      </label>
      <label className="text-sm font-medium" htmlFor="template-description">
        Description
        <Textarea
          id="template-description"
          className="mt-2"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="text-sm font-medium" htmlFor="template-status">
        Status
        <NativeSelect
          id="template-status"
          className="mt-2"
          value={active ? 'ACTIVE' : 'INACTIVE'}
          onChange={(event) => setActive(event.target.value === 'ACTIVE')}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </NativeSelect>
      </label>
      <div>
        <h2 className="font-medium">Medications</h2>
        <div className="mt-3 grid gap-4">
          {items.map((item, index) => (
            <fieldset
              key={index}
              className="grid gap-3 rounded-md border border-line p-4 md:grid-cols-2"
            >
              <legend className="px-1 text-sm font-medium">
                Medication {index + 1}
              </legend>
              {(
                [
                  ['medication_name', 'Medication'],
                  ['strength', 'Strength'],
                  ['form', 'Form'],
                  ['dose', 'Dose'],
                  ['route', 'Route'],
                  ['frequency', 'Frequency'],
                  ['duration', 'Duration'],
                  ['quantity', 'Quantity'],
                ] as const
              ).map(([field, label]) => (
                <label
                  key={field}
                  className="text-sm font-medium"
                  htmlFor={`template-${index}-${field}`}
                >
                  {label}
                  <Input
                    id={`template-${index}-${field}`}
                    className="mt-2"
                    value={item[field]}
                    onChange={(event) =>
                      changeItem(index, field, event.target.value)
                    }
                    required={field === 'medication_name'}
                  />
                </label>
              ))}
              <label
                className="text-sm font-medium md:col-span-2"
                htmlFor={`template-${index}-instructions`}
              >
                Instructions
                <Input
                  id={`template-${index}-instructions`}
                  className="mt-2"
                  value={item.instructions}
                  onChange={(event) =>
                    changeItem(index, 'instructions', event.target.value)
                  }
                />
              </label>
              <div className="flex flex-wrap gap-3 text-sm md:col-span-2">
                <button
                  type="button"
                  className="text-teal"
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="text-teal"
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="text-coral"
                  onClick={() =>
                    setItems((current) =>
                      current.length === 1
                        ? [{ ...emptyLine }]
                        : current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  Remove medication
                </button>
              </div>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 text-sm text-teal"
          onClick={() => setItems((current) => [...current, { ...emptyLine }])}
        >
          Add medication
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          disabled={saving}
        >
          {initial ? 'Save template' : 'Create template'}
        </button>
        {initial && (
          <button
            type="button"
            className="rounded-md border border-line px-4 py-2 text-sm"
            disabled={saving}
            onClick={() => void duplicate()}
          >
            Duplicate
          </button>
        )}
        <Link
          href="/app/prescription-templates"
          className="rounded-md border border-line px-4 py-2 text-sm"
        >
          Cancel
        </Link>
      </div>
      {initial && (
        <div className="border-t border-line pt-4">
          {confirmDelete ? (
            <p className="text-sm">
              Delete this template? Existing prescriptions keep their copied
              medications.{' '}
              <button
                type="button"
                className="text-coral"
                disabled={saving}
                onClick={() => void remove()}
              >
                Confirm delete
              </button>
              {' · '}
              <button
                type="button"
                className="text-teal"
                onClick={() => setConfirmDelete(false)}
              >
                Keep template
              </button>
            </p>
          ) : (
            <button
              type="button"
              className="text-sm text-coral"
              onClick={() => setConfirmDelete(true)}
            >
              Delete template
            </button>
          )}
        </div>
      )}
    </form>
  );
}
