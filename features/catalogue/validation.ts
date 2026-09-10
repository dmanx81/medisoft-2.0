import { z } from 'zod';
export const specimenTypes = [
  'SERUM',
  'PLASMA',
  'WHOLE_BLOOD',
  'URINE',
  'STOOL',
  'SWAB',
  'SPUTUM',
  'OTHER',
] as const;
export const resultTypes = [
  'NUMERIC',
  'TEXT',
  'BOOLEAN',
  'CATEGORICAL',
] as const;
export const rangeSexes = ['ANY', 'MALE', 'FEMALE'] as const;
export const ageUnits = ['YEARS', 'MONTHS', 'DAYS'] as const;
export const lowerOperators = ['GE', 'GT'] as const;
export const upperOperators = ['LE', 'LT'] as const;
const optionalText = (max: number) => z.string().trim().max(max).default('');
const decimalText = z
  .string()
  .trim()
  .max(20)
  .default('')
  .refine(
    (value) => !value || /^-?\d+(?:\.\d+)?$/.test(value),
    'Enter a valid number',
  )
  .refine(
    (value) => !value || Number.isFinite(Number(value)),
    'Enter a valid number',
  );
function asNumber(value: string) {
  return value === '' ? null : Number(value);
}
const catalogueObject = z
  .object({
    code: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(
        z
          .string()
          .min(1, 'Code is required')
          .max(32)
          .regex(
            /^[A-Z0-9][A-Z0-9._-]*$/,
            'Use letters, numbers, dots, underscores or hyphens',
          ),
      ),
    name: z.string().trim().min(1, 'Name is required').max(160),
    short_name: optionalText(40),
    category_id: z.uuid('Select a category'),
    description: optionalText(2000),
    specimen_type: z.enum(specimenTypes),
    result_type: z.enum(resultTypes),
    unit_id: optionalText(36).refine(
      (value) => !value || z.uuid().safeParse(value).success,
      'Select a valid unit',
    ),
    method: optionalText(120),
    display_order: z.number().int().min(0).max(1000000).default(0),
    base_price: optionalText(16).refine(
      (value) => !value || /^\d+(?:\.\d{1,2})?$/.test(value),
      'Enter a price with up to two decimals',
    ),
    is_active: z.boolean().default(true),
  })
  .strict();
export const catalogueSchema = catalogueObject.superRefine((data, ctx) => {
  if (data.result_type === 'NUMERIC' && !data.unit_id)
    ctx.addIssue({
      code: 'custom',
      path: ['unit_id'],
      message: 'Numeric tests require a unit',
    });
});
export type CatalogueInput = z.output<typeof catalogueSchema>;
export const catalogueFieldNames = Object.keys(
  catalogueObject.shape,
) as (keyof CatalogueInput)[];
export const emptyTest: CatalogueInput = {
  ...catalogueSchema.parse({
    code: 'X',
    name: 'Placeholder',
    category_id: '00000000-0000-4000-8000-000000000001',
    specimen_type: 'SERUM',
    result_type: 'TEXT',
  }),
  code: '',
  name: '',
  category_id: '',
};
export const searchSchema = z
  .object({
    query: z.string().trim().max(80).default(''),
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
    sort: z.enum(['code', 'name', 'category', 'updated_at']).default('code'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ALL'),
    category_id: optionalText(36).refine(
      (value) => !value || z.uuid().safeParse(value).success,
      'Select a valid category',
    ),
  })
  .strict();
export type CatalogueSearch = z.output<typeof searchSchema>;
export const createTestSchema = z.object({ data: catalogueSchema }).strict();
export const updateTestSchema = createTestSchema
  .extend({ version: z.number().int().positive() })
  .strict();
export const categorySchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
      .pipe(
        z
          .string()
          .min(1, 'Category code is required')
          .max(32)
          .regex(/^[A-Z][A-Z0-9_]*$/, 'Use letters, numbers or underscores'),
      ),
    name: z.string().trim().min(1, 'Category name is required').max(80),
    display_order: z.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export const unitSchema = z
  .object({
    symbol: z.string().trim().min(1, 'Unit symbol is required').max(32),
    name: z.string().trim().min(1, 'Unit name is required').max(80),
    code: optionalText(32),
  })
  .strict()
  .transform((data) => {
    const generated = (
      data.code || data.symbol.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    )
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    return {
      ...data,
      code:
        generated && /^[A-Z0-9]/.test(generated)
          ? generated
          : `U${generated}`.slice(0, 32),
    };
  })
  .pipe(
    z.object({
      symbol: z.string().min(1).max(32),
      name: z.string().min(1).max(80),
      code: z
        .string()
        .regex(/^[A-Z0-9][A-Z0-9_]*$/, 'Use letters, numbers or underscores'),
    }),
  );
export const rangeSchema = z
  .object({
    sex: z.enum(rangeSexes).default('ANY'),
    age_min: decimalText.refine(
      (value) => value === '' || Number(value) >= 0,
      'Age cannot be negative',
    ),
    age_max: decimalText.refine(
      (value) => value === '' || Number(value) >= 0,
      'Age cannot be negative',
    ),
    age_unit: z.enum(ageUnits).default('YEARS'),
    lower_bound: decimalText,
    upper_bound: decimalText,
    lower_operator: z.enum(lowerOperators).default('GE'),
    upper_operator: z.enum(upperOperators).default('LE'),
    text_range: optionalText(240),
    unit_id: optionalText(36).refine(
      (value) => !value || z.uuid().safeParse(value).success,
      'Select a valid unit',
    ),
    method: optionalText(120),
    critical_low: decimalText,
    critical_high: decimalText,
    valid_from: optionalText(40).refine((value) => {
      if (!value) return true;
      const time = Date.parse(value);
      return !Number.isNaN(time);
    }, 'Enter a valid effective date'),
  })
  .strict()
  .superRefine((data, ctx) => {
    const ageMin = asNumber(data.age_min);
    const ageMax = asNumber(data.age_max);
    if (ageMin !== null && ageMax !== null && ageMin > ageMax)
      ctx.addIssue({
        code: 'custom',
        path: ['age_min'],
        message: 'Minimum age cannot exceed maximum age',
      });
    const lower = asNumber(data.lower_bound);
    const upper = asNumber(data.upper_bound);
    if (lower !== null && upper !== null && lower > upper)
      ctx.addIssue({
        code: 'custom',
        path: ['lower_bound'],
        message: 'Lower bound cannot exceed upper bound',
      });
    const criticalLow = asNumber(data.critical_low);
    const criticalHigh = asNumber(data.critical_high);
    if (
      criticalLow !== null &&
      criticalHigh !== null &&
      criticalLow > criticalHigh
    )
      ctx.addIssue({
        code: 'custom',
        path: ['critical_low'],
        message: 'Critical low cannot exceed critical high',
      });
    if (criticalLow !== null && lower !== null && criticalLow > lower)
      ctx.addIssue({
        code: 'custom',
        path: ['critical_low'],
        message: 'Critical low must be at or below the lower reference bound',
      });
    if (criticalHigh !== null && upper !== null && criticalHigh < upper)
      ctx.addIssue({
        code: 'custom',
        path: ['critical_high'],
        message: 'Critical high must be at or above the upper reference bound',
      });
    if (lower === null && upper === null && !data.text_range)
      ctx.addIssue({
        code: 'custom',
        path: ['lower_bound'],
        message: 'Enter numeric bounds or a text range',
      });
  });
export type RangeInput = z.output<typeof rangeSchema>;
export const emptyRange: RangeInput = {
  ...rangeSchema.parse({ lower_bound: '0', upper_bound: '1' }),
  lower_bound: '',
  upper_bound: '',
};
export const createRangeSchema = z.object({ data: rangeSchema }).strict();
export const retireRangeSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const replaceRangeSchema = createRangeSchema
  .extend({ version: z.number().int().positive() })
  .strict();
export const catalogueIdSchema = z.uuid();
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [
      String(
        issue.path[0] === 'data'
          ? (issue.path[1] ?? 'form')
          : (issue.path[0] ?? 'form'),
      ),
      issue.message,
    ]),
  );
}
