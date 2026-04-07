import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

type TariffPayload = Record<string, unknown>;

@Controller('tariffs')
export class TariffsController {
  @Get()
  getAll() {
    return [];
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return { id };
  }

  @Post()
  create(@Body() payload: TariffPayload) {
    return { ...payload };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: TariffPayload) {
    return { id, ...payload };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id };
  }
}
