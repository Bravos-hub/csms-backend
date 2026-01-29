import { SetMetadata } from '@nestjs/common';

export const SERVICE_SCOPES_KEY = 'service_scopes';

export const ServiceScopes = (...scopes: string[]) => SetMetadata(SERVICE_SCOPES_KEY, scopes);
