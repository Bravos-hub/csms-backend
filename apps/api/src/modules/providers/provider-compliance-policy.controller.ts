import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { UpdateCompliancePolicyDto } from './dto/providers.dto'
import {
  ProviderCompliancePolicyData,
  ProviderCompliancePolicyService,
} from './provider-compliance-policy.service'

@Controller('compliance-policies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProviderCompliancePolicyController {
  constructor(private readonly providerCompliancePolicyService: ProviderCompliancePolicyService) {}

  @Get('provider')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.EVZONE_ADMIN,
    UserRole.EVZONE_OPERATOR,
    UserRole.STATION_OWNER,
    UserRole.STATION_OPERATOR,
    UserRole.SWAP_PROVIDER_ADMIN,
    UserRole.SWAP_PROVIDER_OPERATOR,
  )
  getProviderPolicy() {
    return this.providerCompliancePolicyService.getProviderPolicy()
  }

  @Patch('provider')
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  updateProviderPolicy(@Body() body: UpdateCompliancePolicyDto, @Req() req: any) {
    return this.providerCompliancePolicyService.updateProviderPolicy(
      body as unknown as Partial<ProviderCompliancePolicyData>,
      req.user?.sub,
    )
  }
}
