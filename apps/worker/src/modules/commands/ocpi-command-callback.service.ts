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
    if (await this.wasCallbackAlreadyDelivered(input.commandId)) return;

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

    const maxAttempts = this.callbackMaxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptedAt = new Date().toISOString();
      try {
        const response = await this.postCallback(
          input.responseUrl,
          headers,
          body,
        );
        if (response.ok) {
          await this.annotateCommandCallback(input.commandId, {
            callbackAttemptCount: attempt,
            callbackDeliveredAt: attemptedAt,
            callbackDeliveryStatus: 'DELIVERED',
            callbackError: null,
            callbackFailedAt: null,
            callbackLastAttemptAt: attemptedAt,
            callbackLastHttpStatus: response.status,
          });
          return;
        }

        const error = `HTTP ${response.status}`;
        const shouldRetry = this.shouldRetryDelivery(
          attempt,
          maxAttempts,
          response.status,
        );
        await this.annotateCommandCallback(input.commandId, {
          callbackAttemptCount: attempt,
          callbackDeliveredAt: null,
          callbackDeliveryStatus: shouldRetry ? 'RETRYING' : 'FAILED',
          callbackError: error,
          callbackFailedAt: shouldRetry ? null : attemptedAt,
          callbackLastAttemptAt: attemptedAt,
          callbackLastHttpStatus: response.status,
        });
        this.logger.warn(
          `OCPI callback failed for command=${input.commandId} requestId=${input.requestId} attempt=${attempt}/${maxAttempts} status=${response.status}`,
        );

        if (!shouldRetry) {
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shouldRetry = this.shouldRetryDelivery(attempt, maxAttempts);
        await this.annotateCommandCallback(input.commandId, {
          callbackAttemptCount: attempt,
          callbackDeliveredAt: null,
          callbackDeliveryStatus: shouldRetry ? 'RETRYING' : 'FAILED',
          callbackError: message,
          callbackFailedAt: shouldRetry ? null : attemptedAt,
          callbackLastAttemptAt: attemptedAt,
          callbackLastHttpStatus: null,
        });
        this.logger.warn(
          `OCPI callback request failed for command=${input.commandId} requestId=${input.requestId} attempt=${attempt}/${maxAttempts}: ${message}`,
        );

        if (!shouldRetry) {
          return;
        }
      }

      await this.sleep(this.callbackRetryDelayMs(attempt));
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

  private callbackMaxAttempts(): number {
    const raw = this.config.get<string>('OCPI_COMMAND_CALLBACK_MAX_ATTEMPTS');
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 3;
    }
    return Math.floor(parsed);
  }

  private callbackRetryDelayMs(attempt: number): number {
    const raw = this.config.get<string>('OCPI_COMMAND_CALLBACK_RETRY_DELAY_MS');
    const parsed = raw ? Number(raw) : NaN;
    const baseDelayMs =
      !Number.isFinite(parsed) || parsed < 0 ? 1000 : Math.floor(parsed);
    if (baseDelayMs === 0) return 0;
    const exponent = Math.max(0, attempt - 1);
    return baseDelayMs * 2 ** exponent;
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

  private shouldRetryDelivery(
    attempt: number,
    maxAttempts: number,
    httpStatus?: number,
  ): boolean {
    if (attempt >= maxAttempts) return false;
    if (httpStatus === undefined) return true;
    if (httpStatus === 408 || httpStatus === 425 || httpStatus === 429) {
      return true;
    }
    return httpStatus >= 500;
  }

  private async postCallback(
    responseUrl: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.callbackTimeoutMs(),
    );
    try {
      return await fetch(responseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sleep(delayMs: number): Promise<void> {
    if (delayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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

  private async wasCallbackAlreadyDelivered(
    commandId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.command.findUnique({
      where: { id: commandId },
      select: { payload: true },
    });
    if (!existing) return false;
    const payload = this.ensureObject(existing.payload);
    const ocpi = this.ensureObject(payload.ocpi);
    return (
      this.extractString(ocpi.callbackDeliveryStatus) === 'DELIVERED' &&
      this.extractString(ocpi.callbackDeliveredAt) !== null
    );
  }

  private ensureObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private extractString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
