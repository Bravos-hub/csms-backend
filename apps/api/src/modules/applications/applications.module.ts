import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaService } from '../../prisma.service';
import { SignatureService } from './signature.service';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [DocumentsModule, ConfigModule],
    controllers: [ApplicationsController],
    providers: [ApplicationsService, PrismaService, SignatureService],
    exports: [ApplicationsService],
})
export class ApplicationsModule { }
