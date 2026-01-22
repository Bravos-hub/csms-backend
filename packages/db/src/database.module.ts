import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    /* TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST') || 'localhost',
        port: parseInt(configService.get<string>('DB_PORT') || '5432', 10),
        username: configService.get<string>('DB_USER') || 'postgres',
        password: configService.get<string>('DB_PASSWORD') || 'postgres',
        database: configService.get<string>('DB_NAME') || 'evzone',
        autoLoadEntities: true,
        synchronize: true, // TRUE only for development
      }),
    }), */
  ],
  exports: [/* TypeOrmModule */], // Also commenting out TypeOrmModule from exports
})
export class DatabaseModule { }
