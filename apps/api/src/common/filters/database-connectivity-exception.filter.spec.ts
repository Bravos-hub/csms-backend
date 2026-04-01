import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { DatabaseConnectivityExceptionFilter } from './database-connectivity-exception.filter';

interface MockRequest {
  method: string;
  originalUrl: string;
  url: string;
  header: jest.MockedFunction<(name: string) => string | undefined>;
}

interface MockResponse {
  locals: {
    requestId?: string;
  };
  status: jest.MockedFunction<(statusCode: number) => MockResponse>;
  json: jest.MockedFunction<(body: unknown) => void>;
}

function buildKnownRequestError(code: string, message: string) {
  const error = Object.assign(new Error(message), {
    code,
    clientVersion: '5.22.0',
  });
  Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
  return error as Prisma.PrismaClientKnownRequestError;
}

function createAdapterHost(): HttpAdapterHost {
  return { httpAdapter: {} } as unknown as HttpAdapterHost;
}

function createResponse(requestId: string): MockResponse {
  const response: MockResponse = {
    locals: { requestId },
    status: jest.fn<(statusCode: number) => MockResponse>(),
    json: jest.fn<(body: unknown) => void>(),
  };
  response.status.mockImplementation(() => response);
  return response;
}

function createRequest(method: string, url: string): MockRequest {
  return {
    method,
    originalUrl: url,
    url,
    header: jest
      .fn<(name: string) => string | undefined>()
      .mockReturnValue(undefined),
  };
}

function createHost(
  request: MockRequest,
  response: MockResponse,
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
}

describe('DatabaseConnectivityExceptionFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 503 for connectivity-class Prisma errors', () => {
    const filter = new DatabaseConnectivityExceptionFilter(createAdapterHost());
    const response = createResponse('req-1');
    const request = createRequest('POST', '/api/v1/auth/register');
    const host = createHost(request, response);
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
    const filter = new DatabaseConnectivityExceptionFilter(createAdapterHost());
    const response = createResponse('req-2');
    const request = createRequest('GET', '/u');
    const host = createHost(request, response);
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
