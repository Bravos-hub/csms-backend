import { Module } from '@nestjs/common'
import { ProvidersController } from './providers.controller'
import { ProviderRelationshipsController } from './provider-relationships.controller'
import { ProviderDocumentsController } from './provider-documents.controller'
import { ProviderRequirementsController } from './provider-requirements.controller'
import { ProviderCompliancePolicyController } from './provider-compliance-policy.controller'
import { ProvidersService } from './providers.service'
import { ProviderRelationshipsService } from './provider-relationships.service'
import { ProviderDocumentsService } from './provider-documents.service'
import { ProviderSettlementsService } from './provider-settlements.service'
import { ProviderAuthzService } from './provider-authz.service'
import { ProviderRequirementsService } from './provider-requirements.service'
import { ProviderComplianceService } from './provider-compliance.service'
import { ProviderCompliancePolicyService } from './provider-compliance-policy.service'
import { PrismaService } from '../../prisma.service'

@Module({
  controllers: [
    ProvidersController,
    ProviderRelationshipsController,
    ProviderDocumentsController,
    ProviderRequirementsController,
    ProviderCompliancePolicyController,
  ],
  providers: [
    PrismaService,
    ProviderAuthzService,
    ProviderRequirementsService,
    ProviderCompliancePolicyService,
    ProviderComplianceService,
    ProvidersService,
    ProviderRelationshipsService,
    ProviderDocumentsService,
    ProviderSettlementsService,
  ],
})
export class ProvidersModule {}
