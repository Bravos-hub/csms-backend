import { Injectable, MessageEvent } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'

@Injectable()
export class EventStreamService {
  private readonly subject = new Subject<MessageEvent>()

  emit(type: string, data: unknown) {
    this.subject.next({ type, data: data as any })
  }

  stream(): Observable<MessageEvent> {
    return this.subject.asObservable()
  }
}
