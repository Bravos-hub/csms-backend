import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ProviderRequirementsQueryDto } from './dto/providers.dto'
import { ProviderRequirementsService } from './provider-requirements.service'

@Controller('provider-requirements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
  UserRole.EVZONE_OPERATOR,
  UserRole.STATION_OWNER,
  UserRole.STATION_OPERATOR,
  UserRole.SWAP_PROVIDER_ADMIN,
  UserRole.SWAP_PROVIDER_OPERATOR,
)
export class ProviderRequirementsController {
  constructor(private readonly providerRequirementsService: ProviderRequirementsService) {}

  @Get()
  getAll(@Query() query: ProviderRequirementsQueryDto) {
    return this.providerRequirementsService.list(query.appliesTo)
  }
}

