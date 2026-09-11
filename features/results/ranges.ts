export type SelectableRange = {
  id: string;
  sex: string;
  age_min: string;
  age_max: string;
  age_unit: string;
  method: string;
  unit_symbol: string;
  is_active: boolean;
  valid_from: string;
  valid_to: string;
};

export type RangePatient = {
  sex: string;
  date_of_birth: string;
};

function asNumber(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ageInUnit(
  dateOfBirth: string,
  unit: string,
  at: Date,
): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || birth > at) return null;
  const ms = at.getTime() - birth.getTime();
  if (unit === 'DAYS') return Math.floor(ms / 86400000);
  if (unit === 'MONTHS')
    return (
      (at.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
      (at.getUTCMonth() - birth.getUTCMonth()) -
      (at.getUTCDate() < birth.getUTCDate() ? 1 : 0)
    );
  let years = at.getUTCFullYear() - birth.getUTCFullYear();
  const anniversary = Date.UTC(
    at.getUTCFullYear(),
    birth.getUTCMonth(),
    birth.getUTCDate(),
  );
  if (at.getTime() < anniversary) years -= 1;
  return years;
}

function sexMatches(patientSex: string, rangeSex: string) {
  if (rangeSex === 'ANY') return true;
  if (patientSex === 'MALE') return rangeSex === 'MALE';
  if (patientSex === 'FEMALE') return rangeSex === 'FEMALE';
  return false;
}

function ageMatches(range: SelectableRange, patient: RangePatient, at: Date) {
  const min = asNumber(range.age_min);
  const max = asNumber(range.age_max);
  if (min === null && max === null) return true;
  const age = ageInUnit(patient.date_of_birth, range.age_unit, at);
  if (age === null) return false;
  if (min !== null && age < min) return false;
  if (max !== null && age > max) return false;
  return true;
}

function methodMatches(rangeMethod: string, testMethod: string) {
  if (!rangeMethod) return true;
  return rangeMethod.trim().toLowerCase() === testMethod.trim().toLowerCase();
}

function unitMatches(rangeUnit: string, testUnit: string) {
  if (!rangeUnit) return true;
  return rangeUnit === testUnit;
}

function isEffective(range: SelectableRange, at: Date) {
  if (!range.is_active) return false;
  if (range.valid_from && new Date(range.valid_from) > at) return false;
  if (range.valid_to && new Date(range.valid_to) <= at) return false;
  return true;
}

function specificity(range: SelectableRange, patientSex: string) {
  return [
    range.sex !== 'ANY' && range.sex === patientSex ? 1 : 0,
    range.age_min || range.age_max ? 1 : 0,
    range.method ? 1 : 0,
    range.unit_symbol ? 1 : 0,
    range.valid_from,
    range.id,
  ];
}

export function selectReferenceRange(
  ranges: SelectableRange[],
  patient: RangePatient,
  testMethod: string,
  testUnit: string,
  at = new Date(),
): SelectableRange | null {
  const matches = ranges.filter(
    (range) =>
      isEffective(range, at) &&
      sexMatches(patient.sex, range.sex) &&
      ageMatches(range, patient, at) &&
      methodMatches(range.method, testMethod) &&
      unitMatches(range.unit_symbol, testUnit),
  );
  if (matches.length === 0) return null;
  matches.sort((left, right) => {
    const a = specificity(left, patient.sex);
    const b = specificity(right, patient.sex);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] > b[index]) return -1;
      if (a[index] < b[index]) return 1;
    }
    return 0;
  });
  return matches[0];
}
