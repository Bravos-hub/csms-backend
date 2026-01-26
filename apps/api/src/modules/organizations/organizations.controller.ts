import { Body, Controller, Get, Param, Post } from '@nestjs/common'

@Controller('organizations')
export class OrganizationsController {
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
}
