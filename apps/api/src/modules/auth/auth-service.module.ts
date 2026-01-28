import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/database';
import { ConfigModule } from '@nestjs/config';
import { AuthController, UsersController } from './auth-service.controller';
import { AuthService } from './auth-service.service';
import { NotificationServiceModule } from '../notification/notification-service.module';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    NotificationServiceModule,
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, PrismaService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule { }
