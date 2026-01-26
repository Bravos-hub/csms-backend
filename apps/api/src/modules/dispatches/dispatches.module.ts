import { Module } from '@nestjs/common'
import { DispatchesController } from './dispatches.controller'

@Module({
  controllers: [DispatchesController],
})
export class DispatchesModule {}
