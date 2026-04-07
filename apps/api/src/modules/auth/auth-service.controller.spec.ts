import { AuthController } from './auth-service.controller';
import { AuthService } from './auth-service.service';
import { MetricsService } from '../../common/services/metrics.service';

describe('AuthController', () => {
  it('should be defined', () => {
    const controller = new AuthController(
      {} as unknown as AuthService,
      {} as unknown as MetricsService,
    );
    expect(controller).toBeDefined();
  });
});
