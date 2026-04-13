import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { PrismaModule } from '../../prisma.module';
import { ConfigModule } from '@nestjs/config';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { AuthModule } from '../auth/auth-service.module';

@Module({
  imports: [PrismaModule, ConfigModule, AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, MediaStorageService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
