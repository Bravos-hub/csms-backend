import { Test, TestingModule } from '@nestjs/testing';
import { OcppGatewayController } from './ocpp-gateway.controller';
import { OcppGatewayService } from './ocpp-gateway.service';

describe('OcppGatewayController', () => {
  let ocppGatewayController: OcppGatewayController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [OcppGatewayController],
      providers: [OcppGatewayService],
    }).compile();

    ocppGatewayController = app.get<OcppGatewayController>(OcppGatewayController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(ocppGatewayController.getHello()).toBe('Hello World!');
    });
  });
});
