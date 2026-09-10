export function dateLabel(value: string) {
  if (!value) return 'Not recorded';
  const parts = value.slice(0, 10).split('-');
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
export function ageOn(
  dateOfBirth: string,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!dateOfBirth) return null;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = today.split('-').map(Number);
  return y - year - (m < month || (m === month && d < day) ? 1 : 0);
}
