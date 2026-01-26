import { Module } from '@nestjs/common'
import { SseController } from './sse.controller'
import { EventStreamService } from './sse.service'

@Module({
  controllers: [SseController],
  providers: [EventStreamService],
  exports: [EventStreamService],
})
export class SseModule {}
