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
  'orders:create',
  'orders:edit',
  'orders:place',
  'orders:cancel',
  'samples:read',
  'samples:collect',
  'samples:receive',
  'samples:reject',
  'results:read',
  'results:enter',
  'results:validate',
  'results:verify',
  'results:amend',
  'reports:read',
  'reports:generate',
  'reports:download',
  'reports:deliver',
  'doctors:read',
  'billing:read',
  'tests:read',
  'tests:create',
  'tests:edit',
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
    'orders:create',
    'orders:edit',
    'orders:place',
    'doctors:read',
    'billing:read',
    'tests:read',
  ],
  LAB_TECHNICIAN: [
    'dashboard:read',
    'patients:read',
    'orders:read',
    'samples:read',
    'samples:collect',
    'samples:receive',
    'samples:reject',
    'results:read',
    'results:enter',
    'results:validate',
    'tests:read',
  ],
  BIOCHEMIST: [
    'dashboard:read',
    'patients:read',
    'orders:read',
    'samples:read',
    'samples:collect',
    'samples:receive',
    'samples:reject',
    'results:read',
    'results:enter',
    'results:validate',
    'results:verify',
    'results:amend',
    'reports:read',
    'reports:generate',
    'reports:download',
    'reports:deliver',
    'tests:read',
    'tests:create',
    'tests:edit',
  ],
  DOCTOR: [
    'dashboard:read',
    'patients:read',
    'orders:read',
    'results:read',
    'reports:read',
    'reports:download',
  ],
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
