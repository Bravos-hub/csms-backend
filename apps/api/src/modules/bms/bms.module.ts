import { Module } from '@nestjs/common';
import { BmsService } from './bms.service';
import { BmsController } from './bms.controller';
import { PrismaModule } from '../../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [BmsService],
  controllers: [BmsController],
  exports: [BmsService],
})
export class BmsModule {}
