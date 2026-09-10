import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogueList } from '../components/catalogue/list';
import { CatalogueDetail } from '../components/catalogue/detail';
import { emptyTest } from '../features/catalogue/validation';
import type { LabTest } from '../features/catalogue/types';
const lookups = {
  categories: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      code: 'BIOCHEMISTRY',
      name: 'Biochemistry',
      display_order: 1,
      is_active: true,
    },
  ],
  units: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      code: 'MG_DL',
      symbol: 'mg/dL',
      name: 'Milligrams per decilitre',
    },
  ],
};
void test('catalogue list is searchable and hides create for read-only roles', () => {
  const html = renderToStaticMarkup(
    <CatalogueList
      initial={{ tests: [], total: 0, page: 1, pageSize: 20 }}
      lookups={lookups}
      canCreate
    />,
  );
  for (const text of [
    'Search tests',
    'New test',
    'No tests found',
    'Category',
    'Specimen',
    'Previous',
    'Next',
  ])
    assert.ok(html.includes(text), text);
  const readonly = renderToStaticMarkup(
    <CatalogueList
      initial={{ tests: [], total: 0, page: 1, pageSize: 20 }}
      lookups={lookups}
      canCreate={false}
    />,
  );
  assert.ok(!readonly.includes('href="/app/management/tests/new"'));
});
void test('test detail shows compact definition and range actions for editors', () => {
  const testRow: LabTest = {
    ...emptyTest,
    id: '00000000-0000-4000-8000-000000000003',
    organization_id: 'org',
    code: 'GLU',
    name: 'Glucose',
    category_id: lookups.categories[0].id,
    category_name: 'Biochemistry',
    category_code: 'BIOCHEMISTRY',
    specimen_type: 'SERUM',
    result_type: 'NUMERIC',
    unit_id: lookups.units[0].id,
    unit_symbol: 'mg/dL',
    unit_name: 'Milligrams per decilitre',
    is_active: true,
    version: 1,
    created_by: 'user',
    updated_by: 'user',
    created_at: '2026-09-10',
    updated_at: '2026-09-10',
  };
  const html = renderToStaticMarkup(
    <CatalogueDetail
      test={testRow}
      ranges={[]}
      lookups={lookups}
      canEdit
    />,
  );
  for (const text of [
    'Reference ranges',
    'Add reference range',
    'Deactivate test',
    'No reference ranges recorded',
  ])
    assert.ok(html.includes(text), text);
  const readonly = renderToStaticMarkup(
    <CatalogueDetail
      test={testRow}
      ranges={[]}
      lookups={lookups}
      canEdit={false}
    />,
  );
  assert.ok(!readonly.includes('Add reference range'));
  assert.ok(!readonly.includes('Deactivate test'));
});
