import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

@Injectable()
export class EventStreamService {
  private readonly subject = new Subject<MessageEvent>();

  private normalizeEventData(data: unknown): string | object {
    if (typeof data === 'string') {
      return data;
    }
    if (typeof data === 'object' && data !== null) {
      return data;
    }
    return { value: data };
  }

  emit(type: string, data: unknown) {
    this.subject.next({ type, data: this.normalizeEventData(data) });
  }

  stream(): Observable<MessageEvent> {
    return this.subject.asObservable();
  }
}
