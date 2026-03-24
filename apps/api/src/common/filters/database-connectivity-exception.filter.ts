import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

const CONNECTIVITY_ERROR_CODES = new Set([
  'P1001',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

const CONNECTIVITY_MESSAGE_PATTERNS = [
  'getaddrinfo enotfound',
  'read econnreset',
  'connect econnrefused',
  'connect etimedout',
  'eai_again',
  "can't reach database server",
];

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientUnknownRequestError,
)
export class DatabaseConnectivityExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  private readonly logger = new Logger(
    DatabaseConnectivityExceptionFilter.name,
  );

  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  catch(
    exception:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientInitializationError
      | Prisma.PrismaClientUnknownRequestError,
    host: ArgumentsHost,
  ): void {
    if (!this.isConnectivityError(exception)) {
      super.catch(exception, host);
      return;
    }

    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId =
      typeof response.locals?.requestId === 'string'
        ? response.locals.requestId
        : request.header('x-request-id');
    const errorCode = this.extractErrorCode(exception);

    this.logger.error(
      JSON.stringify({
        event: 'db_connectivity_error',
        requestId,
        method: request.method,
        path: request.originalUrl || request.url,
        code: errorCode,
        message: exception.message,
      }),
    );

    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message:
        'Database connectivity is temporarily unavailable. Please try again.',
      requestId,
    });
  }

  private isConnectivityError(
    error:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientInitializationError
      | Prisma.PrismaClientUnknownRequestError,
  ): boolean {
    const code = this.extractErrorCode(error);
    if (code && CONNECTIVITY_ERROR_CODES.has(code)) {
      return true;
    }

    const message = error.message.toLowerCase();
    return CONNECTIVITY_MESSAGE_PATTERNS.some((pattern) =>
      message.includes(pattern),
    );
  }

  private extractErrorCode(
    error:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientInitializationError
      | Prisma.PrismaClientUnknownRequestError,
  ): string | undefined {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code;
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return error.errorCode;
    }
    return undefined;
  }
}
