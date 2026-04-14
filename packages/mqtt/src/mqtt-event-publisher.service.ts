import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BatteryCabinetStatusEvent,
  BatteryPackStateEvent,
  BatterySwapSessionEvent,
  ChargerStatusEvent,
  ChargerTransactionEvent,
  MeterReadingEvent,
  SmartChargingCommandEvent,
} from './types/mqtt-events';
import { MqttTenantContextService } from './mqtt-tenant-context.service';

@Injectable()
export class MqttEventPublisherService {
  private readonly logger = new Logger(MqttEventPublisherService.name);

  constructor(
    @Inject('MQTT_SERVICE') private mqttClient: ClientProxy,
    private tenantContext: MqttTenantContextService,
  ) {}

  async publishBatteryCabinetStatus(
    event: BatteryCabinetStatusEvent,
    tenantId: string,
  ): Promise<void> {
    const topic = `v1/${tenantId}/${event.siteId}/battery-swap/${event.stationId}/cabinet/${event.cabinetId}/status`;
    await this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published battery cabinet status to ${topic}`);
  }

  async publishBatteryPackState(
    event: BatteryPackStateEvent,
    tenantId: string,
  ): Promise<void> {
    const topic = `v1/${tenantId}/${event.siteId}/battery-swap/pack/${event.packSerialNumber}/state`;
    await this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published battery pack state to ${topic}`);
  }

  async publishBatterySwapSession(
    event: BatterySwapSessionEvent,
    tenantId: string,
  ): Promise<void> {
    const topic = `v1/${tenantId}/${event.siteId}/battery-swap/${event.stationId}/session/${event.swapSessionId}`;
    await this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published battery swap session to ${topic}`);
  }

  async publishChargerStatus(
    event: ChargerStatusEvent,
    tenantId: string,
  ): Promise<void> {
    const topic = `v1/${tenantId}/${event.siteId}/charger/${event.chargerId}/status`;
    await this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published charger status to ${topic}`);
  }

  async publishChargerTransaction(
    event: ChargerTransactionEvent,
    tenantId: string,
  ): Promise<void> {
    const topic = `v1/${tenantId}/${event.siteId}/charger/${event.chargerId}/transaction`;
    await this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published charger transaction to ${topic}`);
  }

  async publishMeterReading(
    event: MeterReadingEvent,
    tenantId: string,
  ): Promise<void> {
    const topic = `v1/${tenantId}/${event.siteId}/meter/${event.meterId}/reading`;
    await this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published meter reading to ${topic}`);
  }

  async publishSmartChargingCommand(
    event: SmartChargingCommandEvent,
    tenantId: string,
  ): Promise<void> {
    const topic = `v1/${tenantId}/${event.siteId}/smart-charging/${event.chargerId}/command`;
    await this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published smart charging command to ${topic}`);
  }
}
