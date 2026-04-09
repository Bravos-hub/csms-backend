import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth-service.module';
import { EnterpriseIamController } from './enterprise-iam.controller';
import { EnterpriseIamService } from './enterprise-iam.service';

@Module({
  imports: [AuthModule],
  controllers: [EnterpriseIamController],
  providers: [EnterpriseIamService],
})
export class EnterpriseIamModule {}
