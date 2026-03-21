import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicles.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  async list(userId: string) {
    return this.prisma.vehicle.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateVehicleDto) {
    return this.prisma.vehicle.create({
      data: {
        ...dto,
        connectors: dto.connectors ?? [],
        userId,
      },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Fetch and assert the caller owns the vehicle. */
  private async findOwned(vehicleId: string, userId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.userId !== userId) throw new ForbiddenException('Not your vehicle');
    return vehicle;
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async update(vehicleId: string, userId: string, dto: UpdateVehicleDto) {
    await this.findOwned(vehicleId, userId);
    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: dto,
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async remove(vehicleId: string, userId: string) {
    const vehicle = await this.findOwned(vehicleId, userId);

    // Clean up Cloudinary photo if present
    if (vehicle.cloudinaryPublicId) {
      await this.mediaStorage.delete(vehicle.cloudinaryPublicId).catch(() => null);
    }

    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
    return { ok: true };
  }

  // ─── Active vehicle ────────────────────────────────────────────────────────

  async getActive(userId: string) {
    return this.prisma.vehicle.findFirst({
      where: { userId, isActive: true },
    });
  }

  async setActive(userId: string, vehicleId: string | null) {
    // Clear all active flags for this user first
    await this.prisma.vehicle.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    if (vehicleId) {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      if (vehicle.userId !== userId) throw new ForbiddenException('Not your vehicle');

      await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { isActive: true },
      });
    }

    return { activeVehicleId: vehicleId };
  }

  // ─── Photo upload ──────────────────────────────────────────────────────────

  async uploadPhoto(vehicleId: string, userId: string, file: Express.Multer.File) {
    const vehicle = await this.findOwned(vehicleId, userId);
    if (!file) throw new BadRequestException('File is required');

    // Delete old photo from Cloudinary if it exists
    if (vehicle.cloudinaryPublicId) {
      await this.mediaStorage.delete(vehicle.cloudinaryPublicId).catch(() => null);
    }

    // Upload new photo
    const result = await this.mediaStorage.uploadBuffer({
      buffer: file.buffer,
      folder: `evzone-vehicles/${userId}`,
      resourceType: 'image',
      context: `vehicleId=${vehicleId}|userId=${userId}`,
    });

    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        photoUrl: result.url,
        cloudinaryPublicId: result.publicId,
      },
    });
  }
}
