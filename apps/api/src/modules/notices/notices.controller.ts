import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('notices')
export class NoticesController {
  @Post()
  create(@Body() payload: unknown) {
    return payload;
  }

  @Get()
  getAll() {
    return [];
  }
}
