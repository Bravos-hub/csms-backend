import { Module } from '@nestjs/common'
import { CommandsModule } from '../commands/commands.module'
import { ChargePointsController } from './charge-points.controller'

@Module({
  imports: [CommandsModule],
  controllers: [ChargePointsController],
})
export class ChargePointsModule {}
