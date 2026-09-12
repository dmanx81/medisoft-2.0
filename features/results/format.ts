export const resultStatusLabels: Record<string, string> = {
  ENTERED: 'Entered',
  TECHNICALLY_VALIDATED: 'Technically validated',
  CLINICALLY_VERIFIED: 'Clinically verified',
  SUPERSEDED: 'Superseded',
};
export const resultFlagLabels: Record<string, string> = {
  UNINTERPRETED: 'Not interpreted',
  NORMAL: 'Normal',
  LOW: 'Low',
  HIGH: 'High',
  CRITICAL_LOW: 'Critical low',
  CRITICAL_HIGH: 'Critical high',
};
export const resultActivityLabels: Record<string, string> = {
  RESULT_ENTERED: 'Result entered',
  RESULT_UPDATED: 'Result updated',
  RESULT_TECHNICALLY_VALIDATED: 'Technically validated',
  RESULT_CLINICALLY_VERIFIED: 'Clinically verified',
  RESULT_AMENDED: 'Result amended',
  LAB_ORDER_IN_PROCESS: 'Result processing started',
  LAB_ORDER_COMPLETED: 'Order completed',
  LAB_ORDER_REOPENED: 'Order reopened',
};
export function displayResultValue(result: {
  result_type_snapshot: string;
  numeric_value: string;
  text_value: string;
  boolean_value: string;
  unit_symbol_snapshot: string;
}) {
  if (result.result_type_snapshot === 'NUMERIC')
    return [result.numeric_value, result.unit_symbol_snapshot]
      .filter(Boolean)
      .join(' ');
  if (result.result_type_snapshot === 'BOOLEAN')
    return result.boolean_value === 'true' ? 'Positive' : 'Negative';
  return result.text_value;
}
export function displayRangeBounds(range: {
  range_lower_snapshot?: string;
  range_upper_snapshot?: string;
  range_lower_operator_snapshot?: string;
  range_upper_operator_snapshot?: string;
  range_text_snapshot?: string;
  range_unit_symbol_snapshot?: string;
  lower_bound?: string;
  upper_bound?: string;
  lower_operator?: string;
  upper_operator?: string;
  text_range?: string;
  unit_symbol?: string;
}) {
  const text = range.range_text_snapshot || range.text_range || '';
  if (text) return text;
  const lower = range.range_lower_snapshot ?? range.lower_bound ?? '';
  const upper = range.range_upper_snapshot ?? range.upper_bound ?? '';
  const lowerOp = range.range_lower_operator_snapshot || range.lower_operator || 'GE';
  const upperOp = range.range_upper_operator_snapshot || range.upper_operator || 'LE';
  const unit =
    range.range_unit_symbol_snapshot || range.unit_symbol || '';
  if (!lower && !upper) return '';
  const left = lower ? `${lowerOp === 'GT' ? '>' : '≥'} ${lower}` : '';
  const right = upper ? `${upperOp === 'LT' ? '<' : '≤'} ${upper}` : '';
  return [left, right].filter(Boolean).join(' and ') + (unit ? ` ${unit}` : '');
}
export function flagTone(flag: string) {
  if (flag === 'CRITICAL_LOW' || flag === 'CRITICAL_HIGH') return 'text-coral';
  if (flag === 'LOW' || flag === 'HIGH') return 'text-coral';
  return 'text-slate';
}
