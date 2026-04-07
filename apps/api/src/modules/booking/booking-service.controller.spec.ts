import { BookingController } from './booking-service.controller';
import { BookingService } from './booking-service.service';

describe('BookingController', () => {
  it('should be defined', () => {
    const bookingService = {} as unknown as BookingService;
    const controller = new BookingController(bookingService);
    expect(controller).toBeDefined();
  });
});
