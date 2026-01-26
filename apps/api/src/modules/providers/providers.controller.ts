import { Controller, Get, Param, Query } from '@nestjs/common'

@Controller('providers')
export class ProvidersController {
  @Get()
  getAll(@Query() query: any) {
    return []
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return { id }
  }
}
