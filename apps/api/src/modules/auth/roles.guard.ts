import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { resolveCanonicalRoleKey, type CanonicalRoleKey } from '@app/domain';
import { ROLES_KEY } from './roles.decorator';

type RequestWithRole = {
  user?: {
    role?: UserRole;
    canonicalRole?: CanonicalRoleKey;
    accessProfile?: {
      canonicalRole?: CanonicalRoleKey;
    };
  };
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      Array<UserRole | CanonicalRoleKey>
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithRole>();
    const currentCanonicalRole =
      request.user?.accessProfile?.canonicalRole ||
      request.user?.canonicalRole ||
      (request.user?.role ? resolveCanonicalRoleKey(request.user.role) : null);

    if (!currentCanonicalRole) {
      return false;
    }

    return requiredRoles.some((role) => {
      const requiredCanonicalRole = resolveCanonicalRoleKey(role);
      return requiredCanonicalRole === currentCanonicalRole;
    });
  }
}
