import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@app/db';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
