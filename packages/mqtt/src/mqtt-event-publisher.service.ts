import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BatteryCabinetStatusEvent,
  BatteryPackStateEvent,
  BatterySwapSessionEvent,
  ChargerStatusEvent,
  ChargerTransactionEvent,
  MeterReadingEvent,
  PvOutputEvent,
  SmartChargingCommandEvent,
  LegacyEvseStatusEvent,
  LegacyEvseTransactionEvent,
} from './types/mqtt-events';
import { MqttTenantContextService } from './mqtt-tenant-context.service';

@Injectable()
export class MqttEventPublisherService {
  private readonly logger = new Logger(MqttEventPublisherService.name);

  constructor(
    @Inject('MQTT_SERVICE') private mqttClient: ClientProxy,
    private tenantContext: MqttTenantContextService,
  ) {}

  publishBatteryCabinetStatus(
    event: BatteryCabinetStatusEvent,
    tenantId: string,
  ): void {
    const topic = `v1/${tenantId}/${event.siteId}/battery-swap/${event.stationId}/cabinet/${event.cabinetId}/status`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published battery cabinet status to ${topic}`);
  }

  publishBatteryPackState(
    event: BatteryPackStateEvent,
    tenantId: string,
  ): void {
    const topic = `v1/${tenantId}/${event.siteId}/battery-swap/pack/${event.packSerialNumber}/state`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published battery pack state to ${topic}`);
  }

  publishBatterySwapSession(
    event: BatterySwapSessionEvent,
    tenantId: string,
  ): void {
    const topic = `v1/${tenantId}/${event.siteId}/battery-swap/${event.stationId}/session/${event.swapSessionId}`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published battery swap session to ${topic}`);
  }

  publishChargerStatus(event: ChargerStatusEvent, tenantId: string): void {
    const topic = `v1/${tenantId}/${event.siteId}/charger/${event.chargerId}/status`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published charger status to ${topic}`);
  }

  publishChargerTransaction(
    event: ChargerTransactionEvent,
    tenantId: string,
  ): void {
    const topic = `v1/${tenantId}/${event.siteId}/charger/${event.chargerId}/transaction`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published charger transaction to ${topic}`);
  }

  publishMeterReading(event: MeterReadingEvent, tenantId: string): void {
    const topic = `v1/${tenantId}/${event.siteId}/meter/${event.meterId}/reading`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published meter reading to ${topic}`);
  }

  publishPvOutput(event: PvOutputEvent, tenantId: string): void {
    const topic = `v1/${tenantId}/${event.siteId}/pv/${event.pvSystemId}/output`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published PV output to ${topic}`);
  }

  publishSmartChargingCommand(
    event: SmartChargingCommandEvent,
    tenantId: string,
  ): void {
    const topic = `v1/${tenantId}/${event.siteId}/smart-charging/${event.chargerId}/command`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published smart charging command to ${topic}`);
  }

  publishLegacyEvseStatus(
    event: LegacyEvseStatusEvent,
    tenantId: string,
  ): void {
    const topic = `v1/${tenantId}/${event.siteId}/legacy-evse/${event.chargerId}/status`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published legacy EVSE status to ${topic}`);
  }

  publishLegacyEvseTransaction(
    event: LegacyEvseTransactionEvent,
    tenantId: string,
  ): void {
    const topic = `v1/${tenantId}/${event.siteId}/legacy-evse/${event.chargerId}/transaction`;
    this.tenantContext.publish(tenantId, topic, event, this.mqttClient);
    this.logger.debug(`Published legacy EVSE transaction to ${topic}`);
  }
}
