import type { Permission } from '@/lib/auth/permissions';
export const navigation: {
  label: string;
  href: string;
  permission: Permission;
  group: string;
  description: string;
}[] = [
  {
    label: 'Dashboard',
    href: '/app',
    permission: 'dashboard:read',
    group: 'Workspace',
    description: 'Daily laboratory overview',
  },
  {
    label: 'Patients',
    href: '/app/patients',
    permission: 'patients:read',
    group: 'Workspace',
    description:
      'Find, register and maintain patient records.',
  },
  {
    label: 'Orders',
    href: '/app/laboratory/orders',
    permission: 'orders:read',
    group: 'Laboratory',
    description: 'Create laboratory orders and collect or accession specimens.',
  },
  {
    label: 'Samples',
    href: '/app/laboratory/samples',
    permission: 'samples:read',
    group: 'Laboratory',
    description:
      'Standalone sample worklists will be available in a future release. Collection and accessioning are on each order.',
  },
  {
    label: 'Results',
    href: '/app/laboratory/results',
    permission: 'results:read',
    group: 'Laboratory',
    description:
      'Enter, technically validate and clinically verify laboratory results.',
  },
  {
    label: 'Reports',
    href: '/app/reports',
    permission: 'reports:read',
    group: 'Practice',
    description:
      'Issue official laboratory reports, download PDFs, record delivery and create secure patient links.',
  },
  {
    label: 'Doctors',
    href: '/app/doctors',
    permission: 'doctors:read',
    group: 'Practice',
    description:
      'Clinical staff profiles used for prescribing. Historical prescriptions keep the doctor identity captured at finalization.',
  },
  {
    label: 'Billing',
    href: '/app/billing',
    permission: 'billing:read',
    group: 'Practice',
    description:
      'Create draft invoices from laboratory orders, issue frozen invoices, record payments, and apply accounting corrections.',
  },
  {
    label: 'Tests',
    href: '/app/management/tests',
    permission: 'tests:read',
    group: 'Management',
    description:
      'Maintain the laboratory test catalogue and versioned reference ranges.',
  },
  {
    label: 'Users',
    href: '/app/management/users',
    permission: 'users:read',
    group: 'Management',
    description:
      'Team invitations and permission management will be available in a future release.',
  },
  {
    label: 'Settings',
    href: '/app/settings',
    permission: 'settings:read',
    group: 'Management',
    description:
      'Organization identity, clinical document branding and billing defaults. Changing branding does not rewrite finalized prescriptions or issued invoices.',
  },
];
