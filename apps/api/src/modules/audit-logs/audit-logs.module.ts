import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { PrismaModule } from '../../prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AuditLogsController],
    providers: [AuditLogsService],
    exports: [AuditLogsService], // Export so other modules can log actions
})
export class AuditLogsModule { }
