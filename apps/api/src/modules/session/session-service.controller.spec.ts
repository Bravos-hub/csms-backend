import { SessionController } from './session-service.controller';

describe('SessionController', () => {
  it('should be defined', () => {
    const controller = new SessionController({} as any);
    expect(controller).toBeDefined();
  });
});
