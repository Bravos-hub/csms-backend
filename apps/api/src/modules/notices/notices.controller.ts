import { Body, Controller, Get, Post, Query } from '@nestjs/common'

@Controller('notices')
export class NoticesController {
  @Post()
  create(@Body() payload: any) {
    return payload
  }

  @Get()
  getAll(@Query() query: any) {
    return []
  }
}
