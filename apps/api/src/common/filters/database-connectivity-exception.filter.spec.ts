import { HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { DatabaseConnectivityExceptionFilter } from './database-connectivity-exception.filter';

function buildKnownRequestError(code: string, message: string) {
  const error = Object.assign(new Error(message), {
    code,
    clientVersion: '5.22.0',
  });
  Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
  return error as Prisma.PrismaClientKnownRequestError;
}

describe('DatabaseConnectivityExceptionFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 503 for connectivity-class Prisma errors', () => {
    const filter = new DatabaseConnectivityExceptionFilter({
      httpAdapter: {} as any,
    } as any);
    const response = {
      locals: { requestId: 'req-1' },
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/auth/register',
      url: '/api/v1/auth/register',
      header: jest.fn().mockReturnValue(undefined),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as any;
    const error = buildKnownRequestError(
      'ENOTFOUND',
      'getaddrinfo ENOTFOUND cpms-db-do-user',
    );

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        requestId: 'req-1',
      }),
    );
  });

  it('delegates non-connectivity Prisma errors to base filter', () => {
    const filter = new DatabaseConnectivityExceptionFilter({
      httpAdapter: {} as any,
    } as any);
    const response = {
      locals: { requestId: 'req-2' },
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ header: jest.fn(), method: 'GET', url: '/u' }),
      }),
    } as any;
    const baseCatchSpy = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
    const error = buildKnownRequestError('P2002', 'Unique constraint failed');

    filter.catch(error, host);

    expect(baseCatchSpy).toHaveBeenCalledWith(error, host);
    expect(response.status).not.toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });
});
