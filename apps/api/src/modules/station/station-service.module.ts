import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/database';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { StationController, ChargePointController } from './station-service.controller';
import { StationService } from './station-service.service';
// import { Station } from './stations/entities/station.entity'; (Removed)
// import { ChargePoint } from './stations/entities/charge-point.entity'; (Removed)
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    ConfigModule,
    // DatabaseModule removed
    // TypeOrmModule removed
    ClientsModule.register([
      {
        name: 'STATION_API',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'station-service',
            brokers: ['localhost:9092'],
          },
          consumer: {
            groupId: 'station-service-consumer',
          },
        },
      },
    ]),
  ],
  controllers: [StationController, ChargePointController],
  providers: [StationService, PrismaService],
})
export class StationServiceModule { }
