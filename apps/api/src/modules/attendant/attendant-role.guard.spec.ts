import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AttendantRoleGuard } from './attendant-role.guard';

describe('AttendantRoleGuard', () => {
  const guard = new AttendantRoleGuard();

  function buildContext(role?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: role ? { role } : {},
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows attendant role', () => {
    expect(guard.canActivate(buildContext('ATTENDANT'))).toBe(true);
  });

  it('rejects non-attendant role', () => {
    expect(() => guard.canActivate(buildContext('SUPER_ADMIN'))).toThrow(
      ForbiddenException,
    );
  });
});
