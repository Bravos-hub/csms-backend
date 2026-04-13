import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@app/db';
import { PrismaService } from './prisma.service';
import { TenantGuardrailsService } from './common/tenant/tenant-guardrails.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [PrismaService, TenantGuardrailsService],
  exports: [PrismaService, TenantGuardrailsService],
})
export class PrismaModule {}
