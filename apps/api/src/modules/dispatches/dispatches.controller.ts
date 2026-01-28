import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'

@Controller('dispatches')
export class DispatchesController {
  @Get()
  getAll(@Query() query: Record<string, unknown>) {
    return [];
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

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() payload: any) {
    return { id, ...payload }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id }
  }
}
