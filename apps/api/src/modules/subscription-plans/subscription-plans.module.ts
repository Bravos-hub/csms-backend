import { Module } from '@nestjs/common';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { SubscriptionPlansService } from './subscription-plans.service';
import { PrismaModule } from '../../prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [SubscriptionPlansController],
    providers: [SubscriptionPlansService],
    exports: [SubscriptionPlansService],
})
export class SubscriptionPlansModule { }
