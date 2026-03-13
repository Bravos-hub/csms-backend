import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { PrismaModule } from '../../prisma.module';
import { ConfigModule } from '@nestjs/config';
import { MediaStorageService } from '../../common/services/media-storage.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, MediaStorageService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
