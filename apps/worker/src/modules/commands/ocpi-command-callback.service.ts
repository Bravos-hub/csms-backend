import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

type CallbackInput = {
  commandId: string;
  requestId: string;
  command: string;
  responseUrl: string;
  partnerId?: string | null;
  status: string;
  error?: string | null;
};

@Injectable()
export class OcpiCommandCallbackService {
  private readonly logger = new Logger(OcpiCommandCallbackService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async deliver(input: CallbackInput): Promise<void> {
    if (!this.isEnabled()) return;
    if (!input.responseUrl) return;

    const result = this.mapStatusToOcpiResult(input.status);
    const body: Record<string, unknown> = {
      result,
    };
    if (input.error) {
      body.message = input.error;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': input.requestId,
      'X-Correlation-ID': input.commandId,
    };
    const token = await this.resolvePartnerToken(input.partnerId);
    if (token) {
      headers.Authorization = `Token ${token}`;
    }

    const timeoutMs = this.callbackTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input.responseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.annotateCommandCallback(input.commandId, {
          callbackLastAttemptAt: new Date().toISOString(),
          callbackError: `HTTP ${response.status}`,
        });
        this.logger.warn(
          `OCPI callback failed for command=${input.commandId} requestId=${input.requestId} status=${response.status}`,
        );
        return;
      }

      await this.annotateCommandCallback(input.commandId, {
        callbackDeliveredAt: new Date().toISOString(),
        callbackLastAttemptAt: new Date().toISOString(),
        callbackError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.annotateCommandCallback(input.commandId, {
        callbackLastAttemptAt: new Date().toISOString(),
        callbackError: message,
      });
      this.logger.warn(
        `OCPI callback request failed for command=${input.commandId} requestId=${input.requestId}: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private isEnabled(): boolean {
    const raw = this.config.get<string>('OCPI_COMMAND_CALLBACKS_ENABLED');
    if (!raw) return true;
    return raw.trim().toLowerCase() === 'true';
  }

  private callbackTimeoutMs(): number {
    const raw = this.config.get<string>('OCPI_COMMAND_CALLBACK_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 5000;
    }
    return Math.floor(parsed);
  }

  private async resolvePartnerToken(
    partnerId?: string | null,
  ): Promise<string | null> {
    if (!partnerId) return null;
    const partner = await this.prisma.ocpiPartner.findUnique({
      where: { id: partnerId },
      select: { tokenC: true, tokenB: true, tokenA: true },
    });
    if (!partner) return null;
    return partner.tokenC || partner.tokenB || partner.tokenA || null;
  }

  private mapStatusToOcpiResult(
    status: string,
  ): 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'TIMEOUT' {
    if (status === 'Accepted') return 'ACCEPTED';
    if (status === 'Rejected' || status === 'Duplicate') return 'REJECTED';
    if (status === 'Timeout') return 'TIMEOUT';
    return 'FAILED';
  }

  private async annotateCommandCallback(
    commandId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.prisma.command.findUnique({
      where: { id: commandId },
      select: { payload: true },
    });
    if (!existing) return;

    const payload = this.ensureObject(existing.payload);
    const ocpi = this.ensureObject(payload.ocpi);
    const updatedPayload = {
      ...payload,
      ocpi: {
        ...ocpi,
        ...patch,
      },
    };

    await this.prisma.command.update({
      where: { id: commandId },
      data: {
        payload: updatedPayload as Prisma.InputJsonValue,
      },
    });
  }

  private ensureObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
}
