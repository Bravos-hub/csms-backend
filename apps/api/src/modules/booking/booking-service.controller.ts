import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { BookingService } from './booking-service.service';
import {
  BookingActionDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/booking.dto';

@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

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
  cancel(@Param('id') id: string, @Body() payload: BookingActionDto) {
    return this.bookingService.cancel(id, payload.reason);
  }

  @Post(':id/no-show')
  markNoShow(@Param('id') id: string, @Body() payload: BookingActionDto) {
    return this.bookingService.markNoShow(id, payload.reason);
  }

  @Post(':id/expire')
  expire(@Param('id') id: string, @Body() payload: BookingActionDto) {
    return this.bookingService.expire(id, payload.reason);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: UpdateBookingDto) {
    return this.bookingService.update(id, payload);
  }

  @Post('maintenance/expire-overdue')
  expireOverdue() {
    return this.bookingService.expireOverdue();
  }
}
