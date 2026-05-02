import { Injectable, Logger } from '@nestjs/common';
import { SubmailService } from '../../common/services/submail.service';

@Injectable()
export class SubmailSmsService {
  private readonly logger = new Logger(SubmailSmsService.name);

  constructor(private readonly submailService: SubmailService) {}

  async sendSms(to: string, body: string) {
    try {
      this.logger.log(`Submail SMS queued for ${to}`);
      this.logger.warn(`FALLBACK: SMS message content sent to ${to}: ${body}`);
      return await this.submailService.sendSms({
        to,
        content: body,
      });
    } catch (error) {
      this.logger.error(`Failed to route SMS via Submail to ${to}`, error);
      throw error;
    }
  }
}
