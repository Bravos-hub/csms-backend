import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class MqttTenantContextService {
  private readonly logger = new Logger(MqttTenantContextService.name);

  publish(
    tenant: string | null,
    topic: string,
    payload: unknown,
    client: ClientProxy,
  ): void {
    const topicTenant = this.extractTenantFromTopic(topic);
    if (!topicTenant) {
      throw new ForbiddenException(
        `Invalid MQTT topic structure: ${topic}. Must follow v1/{tenantId}/... pattern`,
      );
    }

    if (tenant && topicTenant !== tenant) {
      this.logger.warn(
        `Security: Tenant mismatch detected. Context: ${tenant}, Topic: ${topicTenant}`,
      );
      throw new ForbiddenException(
        `Topic tenant ${topicTenant} does not match request context ${tenant}`,
      );
    }

    client.emit(topic, payload);
  }

  async send(
    tenant: string | null,
    topic: string,
    payload: unknown,
    client: ClientProxy,
  ): Promise<unknown> {
    const topicTenant = this.extractTenantFromTopic(topic);
    if (!topicTenant) {
      throw new ForbiddenException(
        `Invalid MQTT topic structure: ${topic}. Must follow v1/{tenantId}/... pattern`,
      );
    }

    if (tenant && topicTenant !== tenant) {
      this.logger.warn(
        `Security: Tenant mismatch on send. Context: ${tenant}, Topic: ${topicTenant}`,
      );
      throw new ForbiddenException(
        `Topic tenant ${topicTenant} does not match request context ${tenant}`,
      );
    }

    return client.send(topic, payload).toPromise();
  }

  private extractTenantFromTopic(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length < 3 || parts[0] !== 'v1') {
      return null;
    }
    return parts[1];
  }

  validateTopicForTenant(topic: string, tenantId: string): boolean {
    const extractedTenant = this.extractTenantFromTopic(topic);
    return extractedTenant === tenantId;
  }
}
