import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

const ALLOWED_ATTENDANT_ROLES = new Set([
  'ATTENDANT',
  'CASHIER',
  'STATION_OPERATOR',
  'TECHNICIAN_ORG',
  'TECHNICIAN_PUBLIC',
]);

@Injectable()
export class AttendantRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { role?: string };
    }>();

    const role = request.user?.role;
    if (!role) {
      throw new UnauthorizedException('Authenticated user role is missing');
    }

    if (!ALLOWED_ATTENDANT_ROLES.has(role)) {
      throw new ForbiddenException(
        'User role is not allowed for attendant APIs',
      );
    }

    return true;
  }
}
