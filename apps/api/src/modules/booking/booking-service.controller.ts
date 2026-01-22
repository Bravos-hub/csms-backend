import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { BookingService } from './booking-service.service';
import { CreateBookingDto, UpdateBookingDto } from './dto/booking.dto';

@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) { }

  @Get()
  findAll() {
    return this.bookingService.findAll();
  }

  @Get('queue')
  getQueue() {
    return this.bookingService.getQueue();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bookingService.findById(id);
  }

  @Post()
  create(@Body() createDto: CreateBookingDto) {
    return this.bookingService.create(createDto);
  }

  @Post(':id/checkin')
  checkin(@Param('id') id: string) {
    return this.bookingService.checkin(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.bookingService.cancel(id);
  }
}
