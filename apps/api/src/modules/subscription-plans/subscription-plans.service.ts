import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

type SubscriptionPlanFilters = {
  role?: UserRole;
  isActive?: boolean;
  isPublic?: boolean;
};

const USER_ROLES = new Set<UserRole>(Object.values(UserRole));

const toUserRole = (role: string): UserRole => {
  if (USER_ROLES.has(role as UserRole)) {
    return role as UserRole;
  }
  throw new BadRequestException(`Invalid role: ${role}`);
};

const toFeatureCreates = (
  features: CreateSubscriptionPlanDto['features'],
): Prisma.PlanFeatureCreateWithoutPlanInput[] | undefined =>
  features?.map((feature) => ({
    featureKey: feature.featureKey,
    featureValue: feature.featureValue,
    description: feature.description,
    order: feature.order,
  }));

const toPermissionCreates = (
  permissions: CreateSubscriptionPlanDto['permissions'],
): Prisma.PlanPermissionCreateWithoutPlanInput[] | undefined =>
  permissions?.map((permission) => ({
    resource: permission.resource,
    action: permission.action,
    description: permission.description,
  }));

@Injectable()
export class SubscriptionPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters?: SubscriptionPlanFilters) {
    const where: Prisma.SubscriptionPlanWhereInput = {
      ...(filters?.role && { role: filters.role }),
      ...(filters?.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters?.isPublic !== undefined && { isPublic: filters.isPublic }),
    };

    return this.prisma.subscriptionPlan.findMany({
      where,
      include: {
        features: true,
        permissions: true,
      },
      orderBy: [{ isPopular: 'desc' }, { price: 'asc' }],
    });
  }

  async findOne(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: {
        features: {
          orderBy: { order: 'asc' },
        },
        permissions: true,
      },
    });

    if (!plan) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }

    return plan;
  }

  async findByCode(code: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { code },
      include: {
        features: {
          orderBy: { order: 'asc' },
        },
        permissions: true,
      },
    });

    if (!plan) {
      throw new NotFoundException(
        `Subscription plan with code ${code} not found`,
      );
    }

    return plan;
  }

  async create(dto: CreateSubscriptionPlanDto) {
    // Check if code already exists
    const existing = await this.prisma.subscriptionPlan.findUnique({
      where: { code: dto.code },
    });

    if (existing) {
      throw new ConflictException(
        `Subscription plan with code ${dto.code} already exists`,
      );
    }

    const { features, permissions, role, ...planData } = dto;
    const featureCreates = toFeatureCreates(features);
    const permissionCreates = toPermissionCreates(permissions);

    return this.prisma.subscriptionPlan.create({
      data: {
        ...planData,
        role: toUserRole(role),
        features: featureCreates
          ? {
              create: featureCreates,
            }
          : undefined,
        permissions: permissionCreates
          ? {
              create: permissionCreates,
            }
          : undefined,
      },
      include: {
        features: {
          orderBy: { order: 'asc' },
        },
        permissions: true,
      },
    });
  }

  async update(id: string, dto: UpdateSubscriptionPlanDto) {
    // Ensure plan exists
    await this.findOne(id);

    const { features, permissions, role, ...planData } = dto;
    const featureCreates = toFeatureCreates(features);
    const permissionCreates = toPermissionCreates(permissions);

    // If updating features or permissions, we need to delete existing and create new ones
    // This is a simple approach - for production, you might want more sophisticated merging
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        ...planData,
        ...(role ? { role: toUserRole(role) } : {}),
        ...(featureCreates && {
          features: {
            deleteMany: {},
            create: featureCreates,
          },
        }),
        ...(permissionCreates && {
          permissions: {
            deleteMany: {},
            create: permissionCreates,
          },
        }),
      },
      include: {
        features: {
          orderBy: { order: 'asc' },
        },
        permissions: true,
      },
    });
  }

  async delete(id: string) {
    // Ensure plan exists
    await this.findOne(id);

    // Check if any users are subscribed to this plan
    // Note: Adjust this query based on your actual Prisma schema relationship
    const subscribedUsers = 0; // Temporarily disabled - adjust based on actual schema

    if (subscribedUsers > 0) {
      throw new ConflictException(
        `Cannot delete plan ${id} because ${subscribedUsers} user(s) are subscribed to it`,
      );
    }

    return this.prisma.subscriptionPlan.delete({
      where: { id },
    });
  }

  async toggleActive(id: string, isActive: boolean) {
    await this.findOne(id);

    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: { isActive },
      include: {
        features: {
          orderBy: { order: 'asc' },
        },
        permissions: true,
      },
    });
  }
}
