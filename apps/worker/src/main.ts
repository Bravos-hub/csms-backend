import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { validateKafkaTopicsOrThrow } from './contracts/kafka-topics';
import { readWorkerSettingsOrThrow } from './config/worker-settings';

dotenv.config({ path: process.env.ENV_FILE || '.env' });

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  const settings = readWorkerSettingsOrThrow();
  validateKafkaTopicsOrThrow();

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  await app.listen(settings.port);

  logger.log(`Worker listening on port ${settings.port}`);
  logger.log(
    `Enabled workloads: outbox=${settings.outbox.enabled}, commandEvents=${settings.commandEvents.enabled}`,
  );
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('WorkerBootstrap');
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Worker failed to start: ${message}`);
  if (error instanceof Error && error.stack) {
    logger.error(error.stack);
  }
  process.exit(1);
});
