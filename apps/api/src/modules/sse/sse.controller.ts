import { Controller, MessageEvent, Sse } from '@nestjs/common'
import { Observable } from 'rxjs'
import { EventStreamService } from './sse.service'

@Controller('sse')
export class SseController {
  constructor(private readonly stream: EventStreamService) {}

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.stream.stream()
  }
}
