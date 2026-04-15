import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class BatterySwapStateMachineService {
  private readonly logger = new Logger(BatterySwapStateMachineService.name);

  // In-memory cache for simplicity, mapping deviceId -> Set of processed messageIds
  private processedMessages = new Map<string, Set<string>>();

  // In-memory cache for device states
  private deviceStates = new Map<string, string>();

  validateEventSequence(
    deviceId: string,
    eventType: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    // Simple state machine validation
    // E.g. we shouldn't get a RECONNECTING_NEW if we haven't DISCONNECTED_OLD
    // Since real world is messy, we just log violations and return valid for now,
    // unless strictly enforcing.

    // For MVP, always accept to prevent dropping data, but update state
    if (eventType === 'INITIATED') this.deviceStates.set(deviceId, 'SWAPPING');
    if (eventType === 'COMPLETE') this.deviceStates.set(deviceId, 'AVAILABLE');

    return Promise.resolve({ valid: true });
  }

  deduplicateEvent(
    deviceId: string,
    messageId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    timestamp: Date,
  ): Promise<boolean> {
    if (!messageId) return Promise.resolve(false);

    let deviceCache = this.processedMessages.get(deviceId);
    if (!deviceCache) {
      deviceCache = new Set<string>();
      this.processedMessages.set(deviceId, deviceCache);
    }

    if (deviceCache.has(messageId)) {
      this.logger.debug(
        `Duplicate message ignored: ${deviceId} / ${messageId}`,
      );
      return Promise.resolve(true); // Is duplicate
    }

    deviceCache.add(messageId);

    // Prevent unbounded memory growth
    if (deviceCache.size > 1000) {
      // Lazy cleanup: clear everything (in production, use Redis sliding window)
      deviceCache.clear();
      deviceCache.add(messageId);
    }

    return Promise.resolve(false); // Not a duplicate
  }
}
