import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SERVICE_SCOPES_KEY } from './service-scopes.decorator';

@Injectable()
export class ServiceScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(SERVICE_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const service = request.service || {};

    const granted = this.normalizeScopes(service.scopes || service.scope);
    if (granted.length === 0) {
      throw new UnauthorizedException('Missing service scopes');
    }

    const hasAll = requiredScopes.every((scope) => granted.includes(scope));
    if (!hasAll) {
      throw new UnauthorizedException('Insufficient service scopes');
    }

    return true;
  }

  private normalizeScopes(input: unknown): string[] {
    if (Array.isArray(input)) {
      return input.map((value) => String(value).trim()).filter(Boolean);
    }
    if (typeof input === 'string') {
      return input
        .split(' ')
        .map((value) => value.trim())
        .filter(Boolean);
    }
    return [];
  }
}
