import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import {
  CreateProviderRelationshipDto,
  ProviderNotesBodyDto,
  ProviderRelationshipsQueryDto,
  RespondProviderRelationshipDto,
  SuspendProviderRelationshipDto,
  TerminateProviderRelationshipDto,
} from './dto/providers.dto'
import { ProviderRelationshipsService } from './provider-relationships.service'

@Controller('provider-relationships')
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
export class ProviderRelationshipsController {
  constructor(private readonly providerRelationshipsService: ProviderRelationshipsService) {}

  @Get()
  getAll(@Query() query: ProviderRelationshipsQueryDto, @Req() req: any) {
    return this.providerRelationshipsService.listRelationships(query, req.user?.sub)
  }

  @Post()
  create(@Body() body: CreateProviderRelationshipDto, @Req() req: any) {
    return this.providerRelationshipsService.requestRelationship(body, req.user?.sub)
  }

  @Post(':id/respond')
  respond(@Param('id') id: string, @Body() body: RespondProviderRelationshipDto, @Req() req: any) {
    return this.providerRelationshipsService.respondToRelationship(id, body, req.user?.sub)
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() body: ProviderNotesBodyDto, @Req() req: any) {
    return this.providerRelationshipsService.approveRelationship(id, body, req.user?.sub)
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string, @Body() body: SuspendProviderRelationshipDto, @Req() req: any) {
    return this.providerRelationshipsService.suspendRelationship(id, body, req.user?.sub)
  }

  @Post(':id/terminate')
  terminate(@Param('id') id: string, @Body() body: TerminateProviderRelationshipDto, @Req() req: any) {
    return this.providerRelationshipsService.terminateRelationship(id, body, req.user?.sub)
  }
}
