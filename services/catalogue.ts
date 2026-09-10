import 'server-only';
import { notFound } from 'next/navigation';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { getTest, listLookups, listRanges } from '@/features/catalogue/repository';
import { CatalogueError } from '@/features/catalogue/types';
export async function testForPage(principal: Principal, id: string) {
  try {
    const test = await getTest(database(), principal, id);
    const ranges = await listRanges(database(), principal, id);
    return { test, ranges };
  } catch (error) {
    if (error instanceof CatalogueError && error.status === 404) notFound();
    throw error;
  }
}
export async function lookupsForPage(principal: Principal) {
  return listLookups(database(), principal);
}
