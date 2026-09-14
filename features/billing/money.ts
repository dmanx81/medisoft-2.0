const moneyPattern = /^\d+(?:\.\d{1,2})?$/;
const signedMoneyPattern = /^-?\d+(?:\.\d{1,2})?$/;
export const ZERO_CENTS = BigInt(0);
const CENTS = BigInt(100);
const TWO = BigInt(2);
const NEGATIVE = BigInt(-1);
const PERCENT_SCALE = BigInt(10000);

export function parseMoney(value: string): bigint {
  if (!signedMoneyPattern.test(value))
    throw new Error('Enter an amount with up to two decimals.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole) * CENTS + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

export function formatMoney(cents: bigint): string {
  const negative = cents < ZERO_CENTS;
  const absolute = negative ? -cents : cents;
  const whole = absolute / CENTS;
  const fraction = (absolute % CENTS).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function isMoney(value: string) {
  return moneyPattern.test(value);
}

export function roundRatio(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator === ZERO_CENTS) throw new Error('Invalid financial ratio.');
  const product = amount * numerator;
  const sign = product < ZERO_CENTS ? NEGATIVE : BigInt(1);
  const absolute = product < ZERO_CENTS ? -product : product;
  const remainder = absolute % denominator;
  const quotient = absolute / denominator;
  return sign * (remainder * TWO >= denominator ? quotient + BigInt(1) : quotient);
}

export function percentOf(amount: bigint, percent: string): bigint {
  if (!moneyPattern.test(percent))
    throw new Error('Enter a percentage with up to two decimals.');
  return roundRatio(amount, parseMoney(percent), PERCENT_SCALE);
}

export type DiscountType = 'NONE' | 'PERCENT' | 'FIXED';

export type BillableLineInput = {
  order_test_id: string;
  code: string;
  name: string;
  quantity: string;
  unit_price: string;
};

export type CalculatedLine = BillableLineInput & {
  line_subtotal: string;
  discount: string;
  tax: string;
  line_total: string;
};

export type InvoiceTotals = {
  lines: CalculatedLine[];
  subtotal: string;
  discount_total: string;
  taxable: string;
  tax_total: string;
  total: string;
};

export function calculateInvoiceTotals(input: {
  lines: BillableLineInput[];
  discount_type: DiscountType;
  discount_value: string;
  tax_rate: string;
}): InvoiceTotals {
  const lines = input.lines.map((line) => {
    const quantity = parseMoney(line.quantity);
    const unit = parseMoney(line.unit_price);
    const lineSubtotal = roundRatio(quantity, unit, CENTS);
    return {
      ...line,
      quantity: formatMoney(quantity),
      unit_price: formatMoney(unit),
      line_subtotal: formatMoney(lineSubtotal),
      discount: formatMoney(ZERO_CENTS),
      tax: formatMoney(ZERO_CENTS),
      line_total: formatMoney(lineSubtotal),
    };
  });
  const subtotal = lines.reduce(
    (sum, line) => sum + parseMoney(line.line_subtotal),
    ZERO_CENTS,
  );
  let discount = ZERO_CENTS;
  if (input.discount_type === 'PERCENT')
    discount = percentOf(subtotal, input.discount_value);
  else if (input.discount_type === 'FIXED')
    discount = parseMoney(input.discount_value);
  if (discount > subtotal) discount = subtotal;
  const taxable = subtotal - discount;
  const tax = percentOf(taxable, input.tax_rate);
  return {
    lines,
    subtotal: formatMoney(subtotal),
    discount_total: formatMoney(discount),
    taxable: formatMoney(taxable),
    tax_total: formatMoney(tax),
    total: formatMoney(taxable + tax),
  };
}
