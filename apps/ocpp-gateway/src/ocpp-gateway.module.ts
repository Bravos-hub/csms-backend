import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { OcppGatewayController } from './ocpp-gateway.controller';
import { OcppGatewayService } from './ocpp-gateway.service';
import { OcppGateway } from './ocpp-gateway.gateway';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'OCPP_SERVICE',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'ocpp-gateway',
            brokers: ['localhost:9092'],
          },
          consumer: {
            groupId: 'ocpp-gateway-consumer',
          },
        },
      },
    ]),
  ],
  controllers: [OcppGatewayController],
  providers: [OcppGatewayService, OcppGateway],
})
export class OcppGatewayModule { }
