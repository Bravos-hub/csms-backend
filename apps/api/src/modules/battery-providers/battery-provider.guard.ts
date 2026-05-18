import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { BatteryProviderAccessService } from './battery-provider-access.service';
import { BatteryProviderContextService } from '@app/db';

type ProviderRequestUser = {
  sub?: string;
  selectedTenantId?: string;
  activeTenantId?: string;
  tenantId?: string;
  activeOrganizationId?: string;
  organizationId?: string;
  orgId?: string;
};

type ProviderScopedRequest = {
  user?: ProviderRequestUser;
  providerScope?: Awaited<
    ReturnType<BatteryProviderAccessService['resolveProviderScope']>
  >;
};

@Injectable()
export class BatteryProviderGuard implements CanActivate {
  constructor(
    private readonly providerAccess: BatteryProviderAccessService,
    private readonly providerContext: BatteryProviderContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProviderScopedRequest>();
    const user = request.user;

    if (!user?.sub) {
      throw new ForbiddenException('User identity not available');
    }

    const tenantId =
      user.selectedTenantId ||
      user.activeTenantId ||
      user.tenantId ||
      user.activeOrganizationId ||
      user.organizationId ||
      user.orgId;

    if (!tenantId) {
      throw new ForbiddenException(
        'Tenant context required for provider scope',
      );
    }

    const scope = await this.providerAccess.resolveProviderScope(
      user.sub,
      tenantId,
    );

    if (!scope) {
      throw new ForbiddenException('Battery provider scope not found');
    }

    // Attach scope to request for controller convenience
    request.providerScope = scope;

    // Run the rest of the request inside the provider context
    return this.providerContext.run(scope, () => true);
  }
}
