import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantRoutingConfigService } from '@app/db';
import {
  TenantDirectoryService,
  TenantOrganizationRoutingRecord,
} from './tenant-directory.service';

export type TenantResolutionResult = {
  host: string | null;
  isLocalhost: boolean;
  subdomain: string | null;
  headerTenantId: string | null;
  hostOrganization: TenantOrganizationRoutingRecord | null;
  headerOrganization: TenantOrganizationRoutingRecord | null;
  provisionalOrganization: TenantOrganizationRoutingRecord | null;
  resolutionSource: 'host_subdomain' | 'header_fallback' | 'none';
};

@Injectable()
export class TenantResolutionService {
  constructor(
    private readonly config: TenantRoutingConfigService,
    private readonly directory: TenantDirectoryService,
  ) {}

  async resolveRequest(request: Request): Promise<TenantResolutionResult> {
    const host = this.resolveHost(request);
    const isLocalhost = this.isLocalHost(host);
    const subdomain = this.resolveSubdomain(host);
    const headerTenantId = this.resolveHeaderTenantId(request);

    const hostOrganization = subdomain
      ? await this.directory.findBySubdomain(subdomain)
      : null;

    const headerOrganization =
      !hostOrganization &&
      headerTenantId &&
      this.config.isHeaderFallbackEnabledForLocalhost(isLocalhost)
        ? await this.directory.findByHeaderTenant(headerTenantId)
        : null;

    const provisionalOrganization = hostOrganization || headerOrganization;

    const resolutionSource = hostOrganization
      ? 'host_subdomain'
      : headerOrganization
        ? 'header_fallback'
        : 'none';

    return {
      host,
      isLocalhost,
      subdomain,
      headerTenantId,
      hostOrganization,
      headerOrganization,
      provisionalOrganization,
      resolutionSource,
    };
  }

  private resolveHost(request: Request): string | null {
    const forwardedHost = request.header('x-forwarded-host');
    const rawHost = forwardedHost || request.header('host') || null;
    if (!rawHost) return null;

    const first = rawHost.split(',')[0]?.trim().toLowerCase();
    if (!first) return null;

    if (first.startsWith('[')) {
      return first.replace(/:\d+$/, '');
    }

    return first.replace(/:\d+$/, '');
  }

  private resolveHeaderTenantId(request: Request): string | null {
    const raw = request.header('x-tenant-id');
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolveSubdomain(host: string | null): string | null {
    if (!host) return null;

    const configuredRoots = this.config.getPlatformHosts();
    for (const root of configuredRoots) {
      if (!root) continue;
      const normalizedRoot = root.toLowerCase();
      if (host === normalizedRoot) {
        return null;
      }

      const suffix = `.${normalizedRoot}`;
      if (!host.endsWith(suffix)) {
        continue;
      }

      const prefix = host.slice(0, -suffix.length);
      if (!prefix) {
        return null;
      }

      const firstLabel = prefix.split('.')[0]?.trim().toLowerCase();
      if (!firstLabel || !this.isValidSubdomain(firstLabel)) {
        return null;
      }

      return firstLabel;
    }

    if (host.endsWith('.localhost')) {
      const first = host.split('.')[0]?.trim().toLowerCase();
      if (first && this.isValidSubdomain(first)) {
        return first;
      }
    }

    return null;
  }

  private isLocalHost(host: string | null): boolean {
    if (!host) return false;

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    ) {
      return true;
    }

    if (host.endsWith('.localhost')) {
      return true;
    }

    return false;
  }

  private isValidSubdomain(value: string): boolean {
    return /^[a-z0-9-]+$/.test(value);
  }
}
