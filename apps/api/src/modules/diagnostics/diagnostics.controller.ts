import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DiagnosticsService } from './diagnostics.service';
import { FaultLifecycleUpdateDto } from './diagnostics.dto';

type AuthenticatedUser = { sub: string };

@Controller('diagnostics')
@UseGuards(JwtAuthGuard)
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  private resolveUserId(user: unknown): string {
    if (
      user &&
      typeof user === 'object' &&
      typeof (user as { sub?: unknown }).sub === 'string'
    ) {
      return (user as AuthenticatedUser).sub;
    }
    throw new UnauthorizedException('Invalid authenticated user payload');
  }

  @Get('vehicles/:vehicleId/faults')
  getFaults(@CurrentUser() user: unknown, @Param('vehicleId') vehicleId: string) {
    return this.diagnostics.getFaults(this.resolveUserId(user), vehicleId);
  }

  @Patch('faults/:faultId/acknowledge')
  acknowledgeFault(
    @CurrentUser() user: unknown,
    @Param('faultId') faultId: string,
    @Body() dto: FaultLifecycleUpdateDto,
  ) {
    return this.diagnostics.acknowledgeFault(this.resolveUserId(user), faultId, dto.note);
  }

  @Patch('faults/:faultId/resolve')
  resolveFault(
    @CurrentUser() user: unknown,
    @Param('faultId') faultId: string,
    @Body() dto: FaultLifecycleUpdateDto,
  ) {
    return this.diagnostics.resolveFault(this.resolveUserId(user), faultId, dto.note);
  }

  // Backward compatibility alias for engine clearFault.
  @Delete('faults/:faultId')
  clearFault(
    @CurrentUser() user: unknown,
    @Param('faultId') faultId: string,
    @Body() dto?: FaultLifecycleUpdateDto,
  ) {
    return this.diagnostics.resolveFault(this.resolveUserId(user), faultId, dto?.note);
  }
}
