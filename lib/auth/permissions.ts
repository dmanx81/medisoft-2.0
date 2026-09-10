export const roles = [
  'PLATFORM_ADMIN',
  'ORG_ADMIN',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'BIOCHEMIST',
  'DOCTOR',
  'VIEWER',
] as const;
export type Role = (typeof roles)[number];
export const permissions = [
  'dashboard:read',
  'patients:read',
  'patients:create',
  'patients:edit',
  'patients:activity',
  'orders:read',
  'samples:read',
  'results:read',
  'reports:read',
  'doctors:read',
  'billing:read',
  'tests:read',
  'users:read',
  'settings:read',
] as const;
export type Permission = (typeof permissions)[number];
const grants: Record<Role, readonly Permission[]> = {
  PLATFORM_ADMIN: permissions,
  ORG_ADMIN: permissions,
  RECEPTIONIST: [
    'dashboard:read',
    'patients:read',
    'patients:create',
    'patients:edit',
    'patients:activity',
    'orders:read',
    'doctors:read',
    'billing:read',
  ],
  LAB_TECHNICIAN: [
    'dashboard:read',
    'orders:read',
    'samples:read',
    'results:read',
    'tests:read',
  ],
  BIOCHEMIST: [
    'dashboard:read',
    'orders:read',
    'samples:read',
    'results:read',
    'reports:read',
    'tests:read',
  ],
  DOCTOR: ['dashboard:read', 'patients:read', 'results:read', 'reports:read'],
  VIEWER: ['dashboard:read'],
};
export function can(role: Role, permission: Permission): boolean {
  return grants[role]?.includes(permission) ?? false;
}
export interface Principal {
  userId: string;
  organizationId: string;
  role: Role;
  name: string;
  organizationName: string;
  sessionHash: string;
}
export function authorize(principal: Principal, permission: Permission) {
  if (!can(principal.role, permission)) throw new Error('Access denied');
}
