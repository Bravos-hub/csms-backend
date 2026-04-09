import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth-service.module';
import { PncController } from './pnc.controller';
import { PncService } from './pnc.service';

@Module({
  imports: [AuthModule],
  controllers: [PncController],
  providers: [PncService],
})
export class PncModule {}
