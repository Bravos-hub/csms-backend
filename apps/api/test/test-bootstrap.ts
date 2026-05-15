import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { KafkaService } from '../src/platform/kafka.service';
import { MailService } from '../src/modules/mail/mail.service';
import { NotificationService } from '../src/modules/notification/notification-service.service';
import { TenantContextService } from '@app/db';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { TenantDirectoryService } from '../src/common/tenant/tenant-directory.service';
import { createTenantResolutionMiddleware } from '../src/common/tenant/tenant-resolution.middleware';
import { PrismaService } from '../src/prisma.service';
import { BatteryProvidersModule } from '../src/modules/battery-providers/battery-providers.module';
import { PrismaModule } from '../src/prisma.module';
import { AuditLogsModule } from '../src/modules/audit-logs/audit-logs.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard';
import { BatteryProviderGuard } from '../src/modules/battery-providers/battery-provider.guard';

export type MockPrisma = {
  batteryProviderUserScope: {
    findFirst: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
  };
  batteryPack: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
    update: jest.Mock;
  };
  batteryTelemetry: {
    findMany: jest.Mock;
  };
  batteryCabinet: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  batteryCabinetSlot: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  swapSession: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
  };
  batteryProviderAlert: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    groupBy: jest.Mock;
  };
  incident: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  station: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
  };
  batteryProviderSlaSnapshot: {
    findFirst: jest.Mock;
    upsert: jest.Mock;
  };
  batteryProviderAssignment: {
    findMany: jest.Mock;
  };
};

export function createPrismaMock(): MockPrisma {
  return {
    batteryProviderUserScope: { findFirst: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    batteryPack: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
    },
    batteryTelemetry: { findMany: jest.fn() },
    batteryCabinet: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    batteryCabinetSlot: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    swapSession: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    batteryProviderAlert: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    incident: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    station: { findMany: jest.fn(), count: jest.fn() },
    auditLog: { create: jest.fn() },
    batteryProviderSlaSnapshot: { findFirst: jest.fn(), upsert: jest.fn() },
    batteryProviderAssignment: { findMany: jest.fn() },
  };
}

export async function bootstrapTestApp(
  prismaMock?: MockPrisma,
): Promise<{
  app: INestApplication;
  moduleRef: TestingModule;
}> {
  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(KafkaService)
    .useValue({
      publish: jest.fn().mockResolvedValue(undefined),
      getConsumer: jest.fn().mockResolvedValue({
        subscribe: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue(undefined),
      }),
      checkConnection: jest.fn().mockResolvedValue(true),
    })
    .overrideProvider(MailService)
    .useValue({ send: jest.fn().mockResolvedValue(undefined) })
    .overrideProvider(NotificationService)
    .useValue({ dispatchToUser: jest.fn().mockResolvedValue(undefined) });

  if (prismaMock) {
    moduleBuilder.overrideProvider(PrismaService).useValue(prismaMock as unknown as PrismaService);
  }

  const moduleRef: TestingModule = await moduleBuilder.compile();

  const app = moduleRef.createNestApplication();

  // Replicate main.ts middleware stack
  app.use(cookieParser());

  const tenantContext = app.get(TenantContextService);
  const tenantResolution = app.get(TenantResolutionService);
  app.use(createTenantResolutionMiddleware(tenantContext, tenantResolution));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  await app.init();
  return { app, moduleRef };
}

@Injectable()
class MockAuthGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const cookie = req.headers?.cookie || '';
    const match = cookie.match(/evzone_access_token=([^;]+)/);
    const secret = this.config.get<string>('JWT_SECRET') || 'test-secret';

    if (match) {
      try {
        const decoded = jwt.verify(match[1], secret) as Record<string, unknown>;
        req.user = decoded;
      } catch {
        // invalid token — let request proceed with no user; endpoint will 401 if guarded
      }
    }
    return true;
  }
}

export async function bootstrapBatteryProviderTestApp(
  prismaMock?: MockPrisma,
): Promise<{
  app: INestApplication;
  moduleRef: TestingModule;
}> {
  const moduleBuilder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
      PrismaModule,
      AuditLogsModule,
      BatteryProvidersModule,
    ],
    providers: [
      {
        provide: TenantResolutionService,
        useValue: {
          resolveRequest: jest.fn().mockResolvedValue({
            host: 'localhost',
            isLocalhost: true,
            subdomain: null,
            headerTenantId: null,
            hostOrganization: null,
            provisionalOrganization: null,
            resolutionSource: 'default',
          }),
        },
      },
      { provide: TenantDirectoryService, useValue: { getTenantConfig: jest.fn() } },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(MockAuthGuard)
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(BatteryProviderGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        req.providerScope = {
          userId: req.user?.sub || 'user-1',
          tenantId: req.user?.tenantId || 'tenant-1',
          providerId: req.user?.providerId || 'provider-1',
          role: req.user?.role || 'ADMIN',
          assignedStationIds: [],
          assignedCabinetIds: [],
        };
        return true;
      },
    })
    .overrideProvider(KafkaService)
    .useValue({
      publish: jest.fn().mockResolvedValue(undefined),
      getConsumer: jest.fn().mockResolvedValue({
        subscribe: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue(undefined),
      }),
      checkConnection: jest.fn().mockResolvedValue(true),
    })
    .overrideProvider(MailService)
    .useValue({ send: jest.fn().mockResolvedValue(undefined) })
    .overrideProvider(NotificationService)
    .useValue({ dispatchToUser: jest.fn().mockResolvedValue(undefined) });

  if (prismaMock) {
    moduleBuilder.overrideProvider(PrismaService).useValue(prismaMock as unknown as PrismaService);
  }

  const moduleRef: TestingModule = await moduleBuilder.compile();

  const app = moduleRef.createNestApplication();

  app.use(cookieParser());

  const tenantContext = app.get(TenantContextService);
  const tenantResolution = app.get(TenantResolutionService);
  app.use(createTenantResolutionMiddleware(tenantContext, tenantResolution));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  await app.init();
  return { app, moduleRef };
}

