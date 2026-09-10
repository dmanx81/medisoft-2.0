import type { Principal } from '../auth/permissions';
// Never accept organization identity from a URL, form or client cookie.
export function organizationScope(principal: Principal) {
  if (!principal.organizationId) throw new Error('Organization required');
  return { text: 'organization_id = $1', values: [principal.organizationId] };
}
export function assertOrganization(
  principal: Principal,
  organizationId: string,
) {
  if (principal.organizationId !== organizationId)
    throw new Error('Access denied');
}
