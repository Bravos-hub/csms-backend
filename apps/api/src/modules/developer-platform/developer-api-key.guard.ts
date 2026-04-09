import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '@app/db';
import { TenantDirectoryService } from '../../common/tenant/tenant-directory.service';
import {
  DeveloperApiKeyContext,
  DeveloperPlatformService,
} from './developer-platform.service';

type DeveloperRequest = Request & {
  developerApiKey?: DeveloperApiKeyContext;
};

@Injectable()
export class DeveloperApiKeyGuard implements CanActivate {
  constructor(
    private readonly developerPlatform: DeveloperPlatformService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantDirectory: TenantDirectoryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeveloperRequest>();
    const rawHeader = request.headers['x-api-key'];
    const apiKey =
      typeof rawHeader === 'string'
        ? rawHeader
        : Array.isArray(rawHeader)
          ? rawHeader[0]
          : null;

    if (!apiKey) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const authenticated = await this.developerPlatform.authenticateApiKey({
      rawApiKey: apiKey,
      route: request.path || request.originalUrl || '/',
      method: request.method || 'GET',
    });

    request.developerApiKey = authenticated;

    const tenantRecord = await this.tenantDirectory.findByOrganizationId(
      authenticated.organizationId,
    );
    const routing = tenantRecord
      ? this.tenantDirectory.toRoutingHint(tenantRecord)
      : null;

    this.tenantContext.set({
      authenticatedOrganizationId: authenticated.organizationId,
      effectiveOrganizationId: authenticated.organizationId,
      resolutionSource: 'jwt_claim',
      mismatchReason: null,
      mismatchRejected: false,
      routing,
    });

    return true;
  }
}
