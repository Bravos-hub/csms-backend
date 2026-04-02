import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateMarketplaceContactEventDto,
  MarketplaceRecentContactsQueryDto,
} from './dto/marketplace-contacts.dto';
import { MarketplaceContactsService } from './marketplace-contacts.service';

type MarketplaceRequestContext = {
  user?: {
    sub?: string;
    id?: string;
  };
};

@Controller('marketplace/contacts')
@UseGuards(JwtAuthGuard)
export class MarketplaceContactsController {
  constructor(
    private readonly marketplaceContactsService: MarketplaceContactsService,
  ) {}

  private actorId(req: MarketplaceRequestContext): string | undefined {
    return req.user?.sub ?? req.user?.id;
  }

  @Post()
  create(
    @Body() body: CreateMarketplaceContactEventDto,
    @Req() req: MarketplaceRequestContext,
  ) {
    return this.marketplaceContactsService.createEvent(this.actorId(req), body);
  }

  @Get('recent')
  getRecent(
    @Query() query: MarketplaceRecentContactsQueryDto,
    @Req() req: MarketplaceRequestContext,
  ) {
    return this.marketplaceContactsService.getRecentContacts(
      this.actorId(req),
      query.limit,
    );
  }
}
