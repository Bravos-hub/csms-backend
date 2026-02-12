import { BookingController } from './booking-service.controller';

describe('BookingController', () => {
  it('should be defined', () => {
    const controller = new BookingController({} as any);
    expect(controller).toBeDefined();
  });
});
