export type ResultFlag =
  | 'UNINTERPRETED'
  | 'NORMAL'
  | 'LOW'
  | 'HIGH'
  | 'CRITICAL_LOW'
  | 'CRITICAL_HIGH';

export type FlagRange = {
  lower_bound: string;
  upper_bound: string;
  lower_operator: string;
  upper_operator: string;
  critical_low: string;
  critical_high: string;
};

function asNumber(value: string) {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function belowLower(value: number, bound: number, operator: string) {
  return operator === 'GT' ? value <= bound : value < bound;
}

function aboveUpper(value: number, bound: number, operator: string) {
  return operator === 'LT' ? value >= bound : value > bound;
}

export function calculateNumericFlag(
  value: number,
  range: FlagRange | null,
): ResultFlag {
  if (!range) return 'UNINTERPRETED';
  const criticalLow = asNumber(range.critical_low);
  const criticalHigh = asNumber(range.critical_high);
  if (criticalLow !== null && value <= criticalLow) return 'CRITICAL_LOW';
  if (criticalHigh !== null && value >= criticalHigh) return 'CRITICAL_HIGH';
  const lower = asNumber(range.lower_bound);
  const upper = asNumber(range.upper_bound);
  if (lower !== null && belowLower(value, lower, range.lower_operator || 'GE'))
    return 'LOW';
  if (upper !== null && aboveUpper(value, upper, range.upper_operator || 'LE'))
    return 'HIGH';
  if (lower === null && upper === null) return 'UNINTERPRETED';
  return 'NORMAL';
}
