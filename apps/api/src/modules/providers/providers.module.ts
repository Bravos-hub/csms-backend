import { Module } from '@nestjs/common'
import { ProvidersController } from './providers.controller'
import { ProviderRelationshipsController } from './provider-relationships.controller'
import { ProviderDocumentsController } from './provider-documents.controller'
import { ProvidersService } from './providers.service'
import { ProviderRelationshipsService } from './provider-relationships.service'
import { ProviderDocumentsService } from './provider-documents.service'
import { ProviderSettlementsService } from './provider-settlements.service'
import { ProviderAuthzService } from './provider-authz.service'
import { PrismaService } from '../../prisma.service'

@Module({
  controllers: [ProvidersController, ProviderRelationshipsController, ProviderDocumentsController],
  providers: [
    PrismaService,
    ProviderAuthzService,
    ProvidersService,
    ProviderRelationshipsService,
    ProviderDocumentsService,
    ProviderSettlementsService,
  ],
})
export class ProvidersModule {}
