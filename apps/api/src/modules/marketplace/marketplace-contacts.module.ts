import { Module } from '@nestjs/common'
import { MarketplaceContactsController } from './marketplace-contacts.controller'
import { MarketplaceContactsService } from './marketplace-contacts.service'

@Module({
  controllers: [MarketplaceContactsController],
  providers: [MarketplaceContactsService],
})
export class MarketplaceContactsModule {}
