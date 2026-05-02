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
  UnauthorizedException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VehiclesService } from './vehicles.service';
import {
  CreateVehicleDto,
  UpdateVehicleDto,
  SetActiveVehicleDto,
  VehiclesScopeQueryDto,
} from './vehicles.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

type AuthenticatedUser = { sub: string };

@Controller('vehicles')
@UseGuards(JwtAuthGuard)
export class VehiclesController {
  constructor(private readonly svc: VehiclesService) {}

  private resolveUserId(user: unknown): string {
    if (
      user &&
      typeof user === 'object' &&
      typeof (user as { sub?: unknown }).sub === 'string'
    ) {
      return (user as AuthenticatedUser).sub;
    }
    throw new UnauthorizedException('Invalid authenticated user payload');
  }

  /** GET /vehicles — list all vehicles for the authenticated user */
  @Get()
  list(@CurrentUser() user: unknown, @Query() query: VehiclesScopeQueryDto) {
    return this.svc.list(this.resolveUserId(user), query.scope ?? 'all');
  }

  /** POST /vehicles — create a new vehicle */
  @Post()
  create(@CurrentUser() user: unknown, @Body() dto: CreateVehicleDto) {
    return this.svc.create(this.resolveUserId(user), dto);
  }

  /** GET /vehicles/active/me — get the user's currently active vehicle */
  @Get('active/me')
  getActive(@CurrentUser() user: unknown) {
    return this.svc.getActive(this.resolveUserId(user));
  }

  /** PUT /vehicles/active/me — set (or clear) the active vehicle */
  @Put('active/me')
  setActive(@CurrentUser() user: unknown, @Body() dto: SetActiveVehicleDto) {
    return this.svc.setActive(this.resolveUserId(user), dto.vehicleId);
  }

  /** PATCH /vehicles/:id — update a vehicle */
  @Patch(':id')
  update(
    @CurrentUser() user: unknown,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.svc.update(id, this.resolveUserId(user), dto);
  }

  /** DELETE /vehicles/:id — delete a vehicle */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: unknown, @Param('id') id: string) {
    return this.svc.remove(id, this.resolveUserId(user));
  }

  /** POST /vehicles/:id/photo — upload or replace vehicle photo */
  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @CurrentUser() user: unknown,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /image\/(jpeg|png|webp|gif)/ })
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10 MB
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.svc.uploadPhoto(id, this.resolveUserId(user), file);
  }
}
