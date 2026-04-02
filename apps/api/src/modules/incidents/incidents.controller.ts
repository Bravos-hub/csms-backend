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
import { IncidentQuery, IncidentsService } from './incidents.service';

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  getAll(@Query() query: IncidentQuery) {
    return this.incidentsService.getAll(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.incidentsService.getById(id);
  }

  @Post()
  create(@Body() payload: Record<string, unknown>) {
    return this.incidentsService.create(payload);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return this.incidentsService.update(id, payload);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.incidentsService.remove(id);
  }
}
