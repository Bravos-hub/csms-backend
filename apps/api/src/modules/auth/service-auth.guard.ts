import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';

type ServiceTokenClaims = jwt.JwtPayload & {
  type?: string;
};

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { service?: ServiceTokenClaims }>();
    const rawAuthorization = request.headers.authorization;
    const authHeader =
      typeof rawAuthorization === 'string' ? rawAuthorization : undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.substring(7);
    const secret = this.config.get<string>('JWT_SERVICE_SECRET');

    if (!secret) {
      throw new Error('JWT_SERVICE_SECRET not configured');
    }

    const verifyOptions: jwt.VerifyOptions = {};
    const issuer = this.config.get<string>('JWT_SERVICE_ISSUER');
    const audience = this.config.get<string>('JWT_SERVICE_AUDIENCE');
    if (issuer) verifyOptions.issuer = issuer;
    if (audience) verifyOptions.audience = audience;

    try {
      const verified = jwt.verify(token, secret, verifyOptions);
      if (
        !verified ||
        typeof verified !== 'object' ||
        Array.isArray(verified)
      ) {
        throw new UnauthorizedException('Invalid token payload');
      }
      const payload = verified as ServiceTokenClaims;
      const tokenType = String(payload?.type || '').toLowerCase();
      if (tokenType !== 'service') {
        throw new UnauthorizedException('Invalid token type');
      }
      request.service = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
