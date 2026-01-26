import { Module } from '@nestjs/common'
import { TariffsController } from './tariffs.controller'

@Module({
  controllers: [TariffsController],
})
export class TariffsModule {}
