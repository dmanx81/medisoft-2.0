import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import {
  fieldErrors,
  templateIdSchema,
  templateSchema,
  templateSearchSchema,
  templateUpdateSchema,
} from './validation';
import {
  ClinicalError,
  type PrescriptionTemplate,
  type PrescriptionTemplateItem,
  type PrescriptionTemplatePage,
  type PrescriptionSnapshotItem,
} from './types';
import { clinicalTransaction } from './transaction';

const headerSelect = `t.id,t.organization_id,t.name,t.description,t.category,t.is_active,t.version,
 t.created_by,t.updated_by,t.created_at::text,t.updated_at::text`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new ClinicalError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}

function templateValue(id: string) {
  if (!templateIdSchema.safeParse(id).success)
    throw new ClinicalError(404, 'NOT_FOUND', 'Prescription template not found.');
  return id;
}

function notFound(label = 'Prescription template'): never {
  throw new ClinicalError(404, 'NOT_FOUND', `${label} not found.`);
}

function duplicateName(): never {
  throw new ClinicalError(
    409,
    'DUPLICATE_NAME',
    'A template with this name already exists in your organization.',
    { name: 'Use a different template name.' },
  );
}

async function assertUniqueName(
  db: QueryRunner,
  organizationId: string,
  name: string,
  excludeId?: string,
) {
  const existing = (
    await db.query<{ id: string }>(
      `SELECT id FROM prescription_templates
 WHERE organization_id=$1 AND lower(btrim(name))=lower(btrim($2))
 AND ($3::uuid IS NULL OR id<>$3)`,
      [organizationId, name, excludeId ?? null],
    )
  ).rows[0];
  if (existing) duplicateName();
}

function mapConstraint(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505'
  ) {
    const constraint = 'constraint' in error ? String(error.constraint) : '';
    if (constraint.includes('prescription_templates_name')) duplicateName();
  }
  throw error;
}

async function audit(
  db: QueryRunner,
  principal: Principal,
  entityId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,'PRESCRIPTION_TEMPLATE',$4,$5::jsonb,$6)`,
    [
      principal.organizationId,
      principal.userId,
      action,
      entityId,
      JSON.stringify(metadata),
      principal.sessionHash,
    ],
  );
}

async function loadItems(
  db: QueryRunner,
  organizationId: string,
  templateId: string,
) {
  return (
    await db.query<PrescriptionTemplateItem>(
      `SELECT id,sort_order,medication_name,strength,form,dose,route,frequency,duration,quantity,instructions
 FROM prescription_template_items
 WHERE organization_id=$1 AND template_id=$2
 ORDER BY sort_order,id`,
      [organizationId, templateId],
    )
  ).rows;
}

async function replaceItems(
  db: QueryRunner,
  organizationId: string,
  templateId: string,
  items: PrescriptionSnapshotItem[],
) {
  await db.query(
    `DELETE FROM prescription_template_items WHERE organization_id=$1 AND template_id=$2`,
    [organizationId, templateId],
  );
  for (const [index, item] of items.entries()) {
    await db.query(
      `INSERT INTO prescription_template_items(
 organization_id,template_id,sort_order,medication_name,strength,form,dose,route,frequency,duration,quantity,instructions)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        organizationId,
        templateId,
        index + 1,
        item.medication_name,
        item.strength,
        item.form,
        item.dose,
        item.route,
        item.frequency,
        item.duration,
        item.quantity,
        item.instructions,
      ],
    );
  }
}

function canManage(principal: Principal) {
  return can(principal.role, 'prescription-templates:manage');
}

export async function getTemplate(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<PrescriptionTemplate> {
  permit(principal, 'prescription-templates:read');
  const row = (
    await db.query<Omit<PrescriptionTemplate, 'items' | 'item_count'>>(
      `SELECT ${headerSelect}
 FROM prescription_templates t
 WHERE t.organization_id=$1 AND t.id=$2`,
      [principal.organizationId, templateValue(id)],
    )
  ).rows[0];
  if (!row) notFound();
  if (!row.is_active && !canManage(principal)) notFound();
  const items = await loadItems(db, principal.organizationId, row.id);
  return { ...row, items, item_count: items.length };
}

export async function listTemplates(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<PrescriptionTemplatePage> {
  permit(principal, 'prescription-templates:read');
  const parsed = templateSearchSchema.safeParse(input ?? {});
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the search options.',
      fieldErrors(parsed.error),
    );
  const { query, category, page, pageSize } = parsed.data;
  const status = canManage(principal) ? parsed.data.status : 'ACTIVE';
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `t.organization_id=$1
 AND ($2='ALL' OR ($2='ACTIVE' AND t.is_active) OR ($2='INACTIVE' AND NOT t.is_active))
 AND ($3='' OR t.category ILIKE $4 ESCAPE '\\')
 AND ($5='' OR t.name ILIKE $6 ESCAPE '\\' OR t.description ILIKE $6 ESCAPE '\\' OR t.category ILIKE $6 ESCAPE '\\')`;
  const categoryPattern = `%${category.replace(/[\\%_]/g, '\\$&')}%`;
  const values = [
    principal.organizationId,
    status,
    category,
    categoryPattern,
    query,
    pattern,
  ];
  const total = Number(
    (
      await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM prescription_templates t WHERE ${where}`,
        values,
      )
    ).rows[0]?.count ?? '0',
  );
  const templates = (
    await db.query<PrescriptionTemplatePage['templates'][number]>(
      `SELECT t.id,t.name,t.description,t.category,t.is_active,t.updated_at::text,
 (SELECT count(*)::int FROM prescription_template_items i
  WHERE i.organization_id=t.organization_id AND i.template_id=t.id) AS item_count
 FROM prescription_templates t
 WHERE ${where}
 ORDER BY lower(t.name),t.id
 LIMIT $7 OFFSET $8`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { templates, total, page, pageSize };
}

export async function createTemplate(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<PrescriptionTemplate> {
  permit(principal, 'prescription-templates:manage');
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the template details.',
      fieldErrors(parsed.error),
    );
  try {
    return await clinicalTransaction(db, async () => {
      await assertUniqueName(db, principal.organizationId, parsed.data.name);
      const inserted = (
        await db.query<{ id: string }>(
          `INSERT INTO prescription_templates(
 organization_id,name,description,category,is_active,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
          [
            principal.organizationId,
            parsed.data.name,
            parsed.data.description,
            parsed.data.category,
            parsed.data.is_active,
            principal.userId,
          ],
        )
      ).rows[0];
      await replaceItems(
        db,
        principal.organizationId,
        inserted.id,
        parsed.data.items,
      );
      await audit(db, principal, inserted.id, 'PRESCRIPTION_TEMPLATE_CREATED', {
        name: parsed.data.name,
        item_count: parsed.data.items.length,
      });
      return getTemplate(db, principal, inserted.id);
    });
  } catch (error) {
    mapConstraint(error);
  }
}

export async function updateTemplate(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<PrescriptionTemplate> {
  permit(principal, 'prescription-templates:manage');
  const parsed = templateUpdateSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the template details.',
      fieldErrors(parsed.error),
    );
  try {
    return await clinicalTransaction(db, async () => {
      const locked = (
        await db.query<{
          id: string;
          is_active: boolean;
          version: number;
        }>(
          `SELECT id,is_active,version FROM prescription_templates
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
          [principal.organizationId, templateValue(id)],
        )
      ).rows[0];
      if (!locked) notFound();
      if (locked.version !== parsed.data.version)
        throw new ClinicalError(
          409,
          'CONFLICT',
          'This template was changed by someone else. Reload and try again.',
        );
      await assertUniqueName(
        db,
        principal.organizationId,
        parsed.data.name,
        locked.id,
      );
      const updated = (
        await db.query<{ id: string }>(
          `UPDATE prescription_templates SET
 name=$3,description=$4,category=$5,is_active=$6,updated_by=$7,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$8 RETURNING id`,
          [
            principal.organizationId,
            locked.id,
            parsed.data.name,
            parsed.data.description,
            parsed.data.category,
            parsed.data.is_active,
            principal.userId,
            parsed.data.version,
          ],
        )
      ).rows[0];
      if (!updated)
        throw new ClinicalError(
          409,
          'CONFLICT',
          'This template was changed by someone else. Reload and try again.',
        );
      await replaceItems(
        db,
        principal.organizationId,
        locked.id,
        parsed.data.items,
      );
      const action =
        locked.is_active !== parsed.data.is_active
          ? parsed.data.is_active
            ? 'PRESCRIPTION_TEMPLATE_ACTIVATED'
            : 'PRESCRIPTION_TEMPLATE_DEACTIVATED'
          : 'PRESCRIPTION_TEMPLATE_UPDATED';
      await audit(db, principal, locked.id, action, {
        name: parsed.data.name,
        item_count: parsed.data.items.length,
      });
      return getTemplate(db, principal, locked.id);
    });
  } catch (error) {
    mapConstraint(error);
  }
}

export async function duplicateTemplate(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<PrescriptionTemplate> {
  permit(principal, 'prescription-templates:manage');
  try {
    return await clinicalTransaction(db, async () => {
      const source = await getTemplate(db, principal, id);
      const copyName = await unusedCopyName(
        db,
        principal.organizationId,
        source.name,
      );
      const inserted = (
        await db.query<{ id: string }>(
          `INSERT INTO prescription_templates(
 organization_id,name,description,category,is_active,created_by,updated_by)
 VALUES($1,$2,$3,$4,true,$5,$5) RETURNING id`,
          [
            principal.organizationId,
            copyName,
            source.description,
            source.category,
            principal.userId,
          ],
        )
      ).rows[0];
      await replaceItems(
        db,
        principal.organizationId,
        inserted.id,
        source.items.map(({ id: _id, sort_order: _order, ...item }) => item),
      );
      await audit(db, principal, inserted.id, 'PRESCRIPTION_TEMPLATE_DUPLICATED', {
        source_id: source.id,
        name: copyName,
        item_count: source.items.length,
      });
      return getTemplate(db, principal, inserted.id);
    });
  } catch (error) {
    mapConstraint(error);
  }
}

export async function deleteTemplate(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<{ id: string }> {
  permit(principal, 'prescription-templates:manage');
  return clinicalTransaction(db, async () => {
    const locked = (
      await db.query<{ id: string; name: string }>(
        `SELECT id,name FROM prescription_templates
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, templateValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    await audit(db, principal, locked.id, 'PRESCRIPTION_TEMPLATE_DELETED', {
      name: locked.name,
    });
    await db.query(
      `DELETE FROM prescription_templates WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, locked.id],
    );
    return { id: locked.id };
  });
}

async function unusedCopyName(
  db: QueryRunner,
  organizationId: string,
  name: string,
) {
  const trimmed = name.trim();
  for (let index = 1; index <= 50; index += 1) {
    const suffix = index === 1 ? ' (copy)' : ` (copy ${index})`;
    const candidate = `${trimmed.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
    const exists = (
      await db.query<{ id: string }>(
        `SELECT id FROM prescription_templates
 WHERE organization_id=$1 AND lower(btrim(name))=lower(btrim($2))`,
        [organizationId, candidate],
      )
    ).rows[0];
    if (!exists) return candidate;
  }
  throw new ClinicalError(
    409,
    'DUPLICATE_NAME',
    'Could not allocate a unique copy name.',
    { name: 'Rename the original template first.' },
  );
}

export async function requireOwnedTemplate(
  db: QueryRunner,
  principal: Principal,
  templateId: string,
  options: { requireActive?: boolean } = {},
) {
  const row = (
    await db.query<{ id: string; is_active: boolean }>(
      `SELECT id,is_active FROM prescription_templates
 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, templateValue(templateId)],
    )
  ).rows[0];
  if (!row)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Select a template from this organization.',
      { source_template_id: 'Template was not found in this organization.' },
    );
  if (options.requireActive && !row.is_active)
    throw new ClinicalError(
      409,
      'CONFLICT',
      'Inactive templates cannot be applied to a prescription.',
      { source_template_id: 'Activate the template first.' },
    );
  return row;
}
