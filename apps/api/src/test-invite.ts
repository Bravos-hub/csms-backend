import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth-service.service';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const authService = app.get(AuthService);
  const prisma = app.get(PrismaService);

  // find an existing user to use as inviter
  const inviter = await prisma.user.findFirst();
  if (!inviter) {
    console.error('No inviter found');
    process.exit(1);
  }

  console.log(`Using inviter: ${inviter.id}`);

  try {
    const result = await authService.inviteUser(
      { email: `test-${Date.now()}@evzonecharging.com`, role: 'ATTENDANT' },
      inviter.id,
    );
    console.log('Success:', result);
  } catch (error) {
    console.error('Failed to invite user:', error);
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Bootstrap failed:', error);
  process.exit(1);
});
