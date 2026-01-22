import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { CloudinaryProvider } from './cloudinary.provider';
import { PrismaModule } from '../../prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [PrismaModule, ConfigModule],
    controllers: [DocumentsController],
    providers: [DocumentsService, CloudinaryProvider],
    exports: [DocumentsService],
})
export class DocumentsModule { }
