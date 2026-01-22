import { Test, TestingModule } from '@nestjs/testing';
import { SessionServiceController } from './session-service.controller';
import { SessionServiceService } from './session-service.service';

describe('SessionServiceController', () => {
  let sessionServiceController: SessionServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [SessionServiceController],
      providers: [SessionServiceService],
    }).compile();

    sessionServiceController = app.get<SessionServiceController>(SessionServiceController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(sessionServiceController.getHello()).toBe('Hello World!');
    });
  });
});
