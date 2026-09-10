import type { Role } from '../auth/permissions';
export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: 'LABORATORY' | 'CLINIC' | 'DIAGNOSTIC_CENTER';
  logo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  country: string;
  timezone: string;
  defaultLanguage: 'en' | 'sq';
  aiEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED' | 'INVITED';
  role: Role;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
// Credentials are deliberately excluded from the user DTO.
export interface AuditEvent {
  id: string;
  organizationId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: Date;
  metadata: Readonly<Record<string, unknown>>;
  sessionHash: string | null;
  ipAddress: string | null;
}
