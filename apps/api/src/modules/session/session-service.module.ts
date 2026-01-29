import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/database';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SessionController } from './session-service.controller';
import { SessionService } from './session-service.service';
import { NotificationServiceModule } from '../notification/notification-service.module';
import { PrismaService } from '../../prisma.service';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule removed
    NotificationServiceModule,
    ClientsModule.register([
      {
        name: 'SESSION_SERVICE',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'session-service',
            brokers: ['localhost:9092'],
          },
          consumer: {
            groupId: 'session-service-consumer',
          },
        },
      },
    ]),
  ],
  controllers: [SessionController],
  providers: [SessionService, PrismaService, OcpiTokenSyncService],
})
export class SessionServiceModule { }
