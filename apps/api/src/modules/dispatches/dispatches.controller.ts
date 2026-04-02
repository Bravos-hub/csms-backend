import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

@Controller('dispatches')
export class DispatchesController {
  @Get()
  getAll(@Query() _query: Record<string, unknown>) {
    void _query;
    return [];
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return { id };
  }

  @Post()
  create(@Body() payload: Record<string, unknown>) {
    return payload;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return { id, ...payload };
  }

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return { id, ...payload };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id };
  }
}
