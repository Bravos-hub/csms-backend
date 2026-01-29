import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) { }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.orgsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: any) {
    return this.orgsService.update(id, payload);
  }

  @Post(':id/payouts')
  setupPayouts(
    @Param('id') id: string,
    @Body() payload: { provider: string; walletNumber: string; taxId?: string }
  ) {
    return this.orgsService.setupPayouts(id, payload);
  }

  @Post(':id/logo')
  uploadLogo(@Param('id') id: string, @Body('logoUrl') logoUrl: string) {
    return this.orgsService.uploadLogo(id, logoUrl);
  }
}
