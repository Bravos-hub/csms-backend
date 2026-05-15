import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  activeTenantId: string;
  selectedTenantId: string;
  role?: string;
  canonicalRole?: string;
  providerId?: string;
  permissions?: string[];
}

export function createProviderAuthCookie(
  app: INestApplication,
  overrides: Partial<JwtPayload>,
): string[] {
  const config = app.get(ConfigService);

  const payload: JwtPayload = {
    sub: overrides.sub || 'user-1',
    tenantId: overrides.tenantId || 'tenant-1',
    activeTenantId: overrides.activeTenantId || overrides.tenantId || 'tenant-1',
    selectedTenantId:
      overrides.selectedTenantId || overrides.tenantId || 'tenant-1',
    role: overrides.role || 'SWAP_PROVIDER_ADMIN',
    canonicalRole: overrides.canonicalRole || 'BATTERY_PROVIDER_ADMIN',
    providerId: overrides.providerId || 'provider-1',
    permissions: overrides.permissions || [
      'batteryProvider.dashboard.read',
      'batteryProvider.packs.read',
      'batteryProvider.packs.manage',
      'batteryProvider.cabinets.read',
      'batteryProvider.cabinets.manage',
      'batteryProvider.alerts.read',
      'batteryProvider.alerts.manage',
      'batteryProvider.maintenance.read',
      'batteryProvider.maintenance.manage',
      'batteryProvider.sla.read',
      'batteryProvider.swapSessions.read',
      'batteryProvider.telemetry.read',
    ],
  };

  const secret = config.get<string>('JWT_SECRET') || 'test-secret';
  const token = jwt.sign(payload, secret, { expiresIn: '1h' });

  return [`evzone_access_token=${token}`];
}
