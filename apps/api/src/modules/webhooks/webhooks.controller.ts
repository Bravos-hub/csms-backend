import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'

@Controller('webhooks')
export class WebhooksController {
  @Get()
  getAll() {
    return []
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return { id }
  }

  @Post()
  create(@Body() payload: any) {
    return payload
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: any) {
    return { id, ...payload }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id }
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return { success: false, id }
  }
}
