import 'server-only';
import { notFound } from 'next/navigation';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import {
  getInvoiceDetail,
  listInvoiceWork,
} from '@/features/billing/repository';
import { BillingError } from '@/features/billing/types';
export async function invoicesForPage(
  principal: Principal,
  input: unknown = {},
) {
  return listInvoiceWork(database(), principal, input);
}
export async function invoiceForPage(principal: Principal, id: string) {
  try {
    return await getInvoiceDetail(database(), principal, id);
  } catch (error) {
    if (error instanceof BillingError && error.status === 404) notFound();
    throw error;
  }
}
