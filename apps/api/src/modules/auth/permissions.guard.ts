import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';

type RequestWithPermissions = {
  user?: {
    permissions?: string[];
    accessProfile?: {
      permissions?: string[];
    };
  };
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPermissions>();
    const grantedPermissions = new Set([
      ...(request.user?.permissions || []),
      ...(request.user?.accessProfile?.permissions || []),
    ]);

    return requiredPermissions.every((permission) =>
      grantedPermissions.has(permission),
    );
  }
}
