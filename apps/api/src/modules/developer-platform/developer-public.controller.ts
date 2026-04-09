import {
  Controller,
  ForbiddenException,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DeveloperApiKeyGuard } from './developer-api-key.guard';
import {
  DeveloperApiKeyContext,
  DeveloperPlatformService,
} from './developer-platform.service';

type DeveloperPublicRequest = Request & {
  developerApiKey?: DeveloperApiKeyContext;
};

@Controller('developer/v1')
@UseGuards(DeveloperApiKeyGuard)
export class DeveloperPublicController {
  constructor(private readonly developerPlatform: DeveloperPlatformService) {}

  @Get('stations/summary')
  async getStationsSummary(
    @Req() req: DeveloperPublicRequest,
  ): Promise<Record<string, unknown>> {
    const apiKeyContext = req.developerApiKey;
    if (!apiKeyContext) {
      throw new ForbiddenException('Developer API key context is missing');
    }

    this.assertScope(apiKeyContext.scopes, [
      '*',
      'stations.read',
      'developer.stations.read',
    ]);

    return this.developerPlatform.getPublicStationsSummary(apiKeyContext);
  }

  private assertScope(scopes: string[], allowedScopes: string[]): void {
    if (scopes.length === 0) {
      return;
    }

    const hasScope = scopes.some((scope) => allowedScopes.includes(scope));
    if (!hasScope) {
      throw new ForbiddenException(
        'API key scope does not allow this endpoint',
      );
    }
  }
}
