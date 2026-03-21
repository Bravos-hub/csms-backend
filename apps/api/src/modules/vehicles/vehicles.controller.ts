import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VehiclesService } from './vehicles.service';
import {
  CreateVehicleDto,
  UpdateVehicleDto,
  SetActiveVehicleDto,
} from './vehicles.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('vehicles')
@UseGuards(JwtAuthGuard)
export class VehiclesController {
  constructor(private readonly svc: VehiclesService) {}

  /** GET /vehicles — list all vehicles for the authenticated user */
  @Get()
  list(@CurrentUser() user: any) {
    return this.svc.list(user.sub);
  }

  /** POST /vehicles — create a new vehicle */
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateVehicleDto) {
    return this.svc.create(user.sub, dto);
  }

  /** GET /vehicles/active/me — get the user's currently active vehicle */
  @Get('active/me')
  getActive(@CurrentUser() user: any) {
    return this.svc.getActive(user.sub);
  }

  /** PUT /vehicles/active/me — set (or clear) the active vehicle */
  @Put('active/me')
  setActive(@CurrentUser() user: any, @Body() dto: SetActiveVehicleDto) {
    return this.svc.setActive(user.sub, dto.vehicleId);
  }

  /** PATCH /vehicles/:id — update a vehicle */
  @Patch(':id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.svc.update(id, user.sub, dto);
  }

  /** DELETE /vehicles/:id — delete a vehicle */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.remove(id, user.sub);
  }

  /** POST /vehicles/:id/photo — upload or replace vehicle photo */
  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /image\/(jpeg|png|webp|gif)/ })
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10 MB
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.svc.uploadPhoto(id, user.sub, file);
  }
}
