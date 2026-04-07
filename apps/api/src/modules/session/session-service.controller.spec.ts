import { SessionController } from './session-service.controller';
import { SessionService } from './session-service.service';

describe('SessionController', () => {
  it('should be defined', () => {
    const sessionService = {} as unknown as SessionService;
    const controller = new SessionController(sessionService);
    expect(controller).toBeDefined();
  });
});
