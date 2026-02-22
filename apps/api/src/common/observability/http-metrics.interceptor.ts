import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { HttpMetricsService } from './http-metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: HttpMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Date.now() - startedAt;
        this.metrics.record({
          method: request.method,
          route: this.resolveRoute(request),
          statusCode: response.statusCode || 500,
          durationMs,
        });
      }),
    );
  }

  private resolveRoute(request: Request): string {
    const routeCandidate: unknown = request.route;
    const routePath = this.readRoutePath(routeCandidate);
    const resolvedPath = routePath || request.path || request.url || '/';

    const baseUrl = request.baseUrl || '';
    const route = `${baseUrl}${resolvedPath}`.trim();

    if (!route) {
      return '/';
    }

    return route.startsWith('/') ? route : `/${route}`;
  }

  private readRoutePath(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const candidate = value as { path?: unknown };
    if (typeof candidate.path === 'string' && candidate.path.length > 0) {
      return candidate.path;
    }
    return undefined;
  }
}
