import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/database';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
// import { User } from './users/entities/user.entity'; (Removed)
import { AuthController, UsersController } from './auth-service.controller';
import { AuthService } from './auth-service.service';
import { NotificationServiceModule } from '../notification/notification-service.module';
import { PrismaService } from '../../prisma.service';
// We will create UsersModule later or just use entities here for now
// Best practice: feature modules. 

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule removed
    NotificationServiceModule,
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, PrismaService],
})
export class AuthModule { }
