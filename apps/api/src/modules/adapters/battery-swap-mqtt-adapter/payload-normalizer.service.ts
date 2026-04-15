import { Injectable, Logger } from '@nestjs/common';
import {
  BatteryCabinetStatusEvent,
  BatteryPackStateEvent,
  BatterySwapSessionEvent,
} from '@app/mqtt';

export interface RawVendorPayload {
  device_id: string;
  type: string;
  data: Record<string, unknown>;
  ts: number;
}

@Injectable()
export class BatterySwapPayloadNormalizer {
  private readonly logger = new Logger(BatterySwapPayloadNormalizer.name);

  normalizeCabinetStatus(
    tenantId: string,
    siteId: string,
    payload: RawVendorPayload,
  ): BatteryCabinetStatusEvent {
    const data = payload.data;
    return {
      tenantId,
      siteId,
      stationId: payload.device_id,
      cabinetId: (data.cabinet_id as string) || 'DEFAULT_CABINET',
      timestamp: new Date(payload.ts || Date.now()),
      isOnline: data.status === 'ONLINE',
      powerState:
        data.power_state === 'CRITICAL'
          ? 'CRITICAL'
          : data.power_state === 'LOW'
            ? 'LOW'
            : 'OK',
      doorLocked:
        typeof data.door_locked === 'boolean' ? data.door_locked : true,
      robotHealth: data.robot_error ? 'FAULT' : 'OK',
      totalSlots: (data.total_slots as number) || 10,
      occupiedSlots: (data.occupied_slots as number) || 0,
      faultCodes: (data.fault_codes as string[]) || [],
    };
  }

  normalizePackState(
    tenantId: string,
    siteId: string,
    payload: RawVendorPayload,
  ): BatteryPackStateEvent {
    const data = payload.data;
    return {
      tenantId,
      siteId,
      timestamp: new Date(payload.ts || Date.now()),
      packSerialNumber: (data.pack_sn as string) || 'UNKNOWN',
      slotId: (data.slot_id as string) || '0',
      soc: (data.soc as number) || 0,
      health: (data.soh as number) || 100,
      voltage: (data.voltage as number) || 0,
      current: (data.current as number) || 0,
      cycles: (data.cycles as number) || 0,
      temperature: (data.temp as number) || 25,
      status: data.is_swapping
        ? 'SWAPPING'
        : (data.soc as number) < 100
          ? 'DEGRADED'
          : 'AVAILABLE',
    };
  }

  normalizeSessionEvent(
    tenantId: string,
    siteId: string,
    payload: RawVendorPayload,
  ): BatterySwapSessionEvent {
    const data = payload.data;
    let stage: BatterySwapSessionEvent['stage'] = 'INITIATED';
    switch (data.stage) {
      case 'DOCKING':
        stage = 'DOCKING';
        break;
      case 'DISCONNECT':
        stage = 'DISCONNECTING_OLD';
        break;
      case 'RECONNECT':
        stage = 'RECONNECTING_NEW';
        break;
      case 'UNDOCK':
        stage = 'UNDOCKING';
        break;
      case 'COMPLETE':
        stage = 'COMPLETE';
        break;
    }

    return {
      tenantId,
      siteId,
      timestamp: new Date(payload.ts || Date.now()),
      stationId: payload.device_id,
      swapSessionId: (data.session_id as string) || 'UNKNOWN',
      vehicleId: data.vehicle_id as string | undefined,
      inboundPackSerialNumber: (data.inbound_pack as string) || 'UNKNOWN',
      outboundPackSerialNumber: (data.outbound_pack as string) || 'UNKNOWN',
      stage,
      duration: data.duration as number | undefined,
      error: data.error as string | undefined,
    };
  }
}
