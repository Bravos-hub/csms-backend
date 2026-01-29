import { Module } from '@nestjs/common';
import { OcpiInternalController } from './ocpi-internal.controller';
import { CommandsService } from '../commands/commands.service';
import { PrismaService } from '../../prisma.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [OcpiInternalController],
  providers: [PrismaService, CommandsService],
})
export class OcpiInternalModule {}
