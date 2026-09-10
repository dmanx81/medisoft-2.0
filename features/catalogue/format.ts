import type { LabRange } from './types';
export const specimenLabels: Record<string, string> = {
  SERUM: 'Serum',
  PLASMA: 'Plasma',
  WHOLE_BLOOD: 'Whole Blood',
  URINE: 'Urine',
  STOOL: 'Stool',
  SWAB: 'Swab',
  SPUTUM: 'Sputum',
  OTHER: 'Other',
};
export const resultTypeLabels: Record<string, string> = {
  NUMERIC: 'Numeric',
  TEXT: 'Text',
  BOOLEAN: 'Boolean',
  CATEGORICAL: 'Categorical',
};
export const sexLabels: Record<string, string> = {
  ANY: 'Any',
  MALE: 'Male',
  FEMALE: 'Female',
};
export const ageUnitLabels: Record<string, string> = {
  YEARS: 'years',
  MONTHS: 'months',
  DAYS: 'days',
};
export function ageBand(range: Pick<LabRange, 'age_min' | 'age_max' | 'age_unit'>) {
  const unit = ageUnitLabels[range.age_unit] ?? range.age_unit.toLowerCase();
  if (!range.age_min && !range.age_max) return 'Any age';
  if (range.age_min && range.age_max)
    return `${range.age_min}–${range.age_max} ${unit}`;
  if (range.age_min) return `≥${range.age_min} ${unit}`;
  return `≤${range.age_max} ${unit}`;
}
function operatorMark(operator: string, side: 'lower' | 'upper') {
  if (side === 'lower') return operator === 'GT' ? '>' : '≥';
  return operator === 'LT' ? '<' : '≤';
}
export function rangeText(range: LabRange) {
  if (range.text_range && !range.lower_bound && !range.upper_bound)
    return range.text_range;
  const lower =
    range.lower_bound === ''
      ? ''
      : `${operatorMark(range.lower_operator, 'lower')}${range.lower_bound}`;
  const upper =
    range.upper_bound === ''
      ? ''
      : `${operatorMark(range.upper_operator, 'upper')}${range.upper_bound}`;
  const numeric =
    lower && upper
      ? `${range.lower_bound}–${range.upper_bound}`
      : lower || upper || '';
  return [numeric, range.text_range].filter(Boolean).join(' · ');
}
export function stampLabel(value: string) {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}
