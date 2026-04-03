import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { CanonicalRoleKey } from '@app/domain';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<UserRole | CanonicalRoleKey>) =>
  SetMetadata(ROLES_KEY, roles);
