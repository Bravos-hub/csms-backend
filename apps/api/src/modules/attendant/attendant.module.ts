import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeatureFlagsModule } from '../../feature-flags/feature-flags.module';
import { PrismaModule } from '../../prisma.module';
import { AuthModule } from '../auth/auth-service.module';
import { MailModule } from '../mail/mail.module';
import { NotificationServiceModule } from '../notification/notification-service.module';
import { AttendantController } from './attendant.controller';
import { AttendantService } from './attendant.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    FeatureFlagsModule,
    AuthModule,
    NotificationServiceModule,
    MailModule,
  ],
  controllers: [AttendantController],
  providers: [AttendantService],
})
export class AttendantModule {}
