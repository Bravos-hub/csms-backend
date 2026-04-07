import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SiteController } from './site-service.controller';
import { SiteService } from './site-service.service';

@Module({
  imports: [ConfigModule],
  controllers: [SiteController],
  providers: [SiteService],
})
export class SiteServiceModule {}
