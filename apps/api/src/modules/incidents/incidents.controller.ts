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
import { IncidentsService } from './incidents.service';

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  getAll(@Query() query: any) {
    return this.incidentsService.getAll(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.incidentsService.getById(id);
  }

  @Post()
  create(@Body() payload: any) {
    return this.incidentsService.create(payload);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: any) {
    return this.incidentsService.update(id, payload);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.incidentsService.remove(id);
  }
}
