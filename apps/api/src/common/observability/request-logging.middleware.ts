import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HttpRequest');

const REQUEST_ID_HEADER = 'x-request-id';

function readSampleRate(): number {
  const raw = process.env.REQUEST_LOGGING_SAMPLE_RATE ?? '1';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

function shouldLogRequest(): boolean {
  const enabled = (process.env.REQUEST_LOGGING_ENABLED ?? 'true') === 'true';
  if (!enabled) return false;
  const sampleRate = readSampleRate();
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return Math.random() <= sampleRate;
}

function resolveRequestId(request: Request): string {
  const headerValue = request.header(REQUEST_ID_HEADER);
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  return randomUUID();
}

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(request);
  response.locals.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function requestLoggingMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const shouldLog = shouldLogRequest();
  if (!shouldLog) {
    next();
    return;
  }

  const startedAt = Date.now();
  response.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const requestId =
      typeof response.locals.requestId === 'string'
        ? response.locals.requestId
        : undefined;

    const payload = {
      event: 'http_request',
      requestId,
      method: request.method,
      path: request.originalUrl || request.url,
      statusCode: response.statusCode,
      durationMs,
      ip: request.ip,
      userAgent: request.get('user-agent') || '',
      timestamp: new Date().toISOString(),
    };

    logger.log(JSON.stringify(payload));
  });

  next();
}
