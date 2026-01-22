import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';

@Injectable()
export class OcppGatewayService implements OnModuleInit {
  constructor(
    @Inject('OCPP_SERVICE') private readonly client: ClientKafka
  ) { }

  async onModuleInit() {
    this.client.subscribeToResponseOf('ocpp.action');
    await this.client.connect();
  }

  handleMessage(chargePointId: string, message: any) {
    // Determine message type and action
    // Usually [2, "UniqueId", "Action", {payload}]
    const [messageType, uniqueId, action, payload] = message;

    // Publish to Kafka
    this.client.emit('ocpp.message', {
      chargePointId,
      action,
      payload,
      timestamp: new Date().toISOString()
    });
  }
}
