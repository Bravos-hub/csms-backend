import { Module } from '@nestjs/common';
import { OcpiInternalController } from './ocpi-internal.controller';
import { ConfigModule } from '@nestjs/config';
import { CommandsModule } from '../commands/commands.module';

@Module({
  imports: [ConfigModule, CommandsModule],
  controllers: [OcpiInternalController],
})
export class OcpiInternalModule {}
