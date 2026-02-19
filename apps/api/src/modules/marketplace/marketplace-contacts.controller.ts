import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import {
  CreateMarketplaceContactEventDto,
  MarketplaceRecentContactsQueryDto,
} from './dto/marketplace-contacts.dto'
import { MarketplaceContactsService } from './marketplace-contacts.service'

@Controller('marketplace/contacts')
@UseGuards(JwtAuthGuard)
export class MarketplaceContactsController {
  constructor(private readonly marketplaceContactsService: MarketplaceContactsService) {}

  @Post()
  create(@Body() body: CreateMarketplaceContactEventDto, @Req() req: any) {
    return this.marketplaceContactsService.createEvent(req.user?.sub || req.user?.id, body)
  }

  @Get('recent')
  getRecent(@Query() query: MarketplaceRecentContactsQueryDto, @Req() req: any) {
    return this.marketplaceContactsService.getRecentContacts(req.user?.sub || req.user?.id, query.limit)
  }
}
