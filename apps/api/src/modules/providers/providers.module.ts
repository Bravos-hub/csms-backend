import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProvidersController } from './providers.controller';
import { ProviderRelationshipsController } from './provider-relationships.controller';
import { ProviderDocumentsController } from './provider-documents.controller';
import { ProviderRequirementsController } from './provider-requirements.controller';
import { ProviderCompliancePolicyController } from './provider-compliance-policy.controller';
import { ProvidersService } from './providers.service';
import { ProviderRelationshipsService } from './provider-relationships.service';
import { ProviderDocumentsService } from './provider-documents.service';
import { ProviderSettlementsService } from './provider-settlements.service';
import { ProviderAuthzService } from './provider-authz.service';
import { ProviderRequirementsService } from './provider-requirements.service';
import { ProviderComplianceService } from './provider-compliance.service';
import { ProviderCompliancePolicyService } from './provider-compliance-policy.service';
import { MediaStorageService } from '../../common/services/media-storage.service';

@Module({
  imports: [ConfigModule],
  controllers: [
    ProvidersController,
    ProviderRelationshipsController,
    ProviderDocumentsController,
    ProviderRequirementsController,
    ProviderCompliancePolicyController,
  ],
  providers: [
    ProviderAuthzService,
    ProviderRequirementsService,
    ProviderCompliancePolicyService,
    ProviderComplianceService,
    MediaStorageService,
    ProvidersService,
    ProviderRelationshipsService,
    ProviderDocumentsService,
    ProviderSettlementsService,
  ],
})
export class ProvidersModule {}
