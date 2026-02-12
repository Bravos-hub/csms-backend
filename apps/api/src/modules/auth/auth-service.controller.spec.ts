import { AuthController } from './auth-service.controller';

describe('AuthController', () => {
  it('should be defined', () => {
    const controller = new AuthController({} as any, {} as any);
    expect(controller).toBeDefined();
  });
});
