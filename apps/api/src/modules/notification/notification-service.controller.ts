import { Controller, Get, Post, Body } from '@nestjs/common';
import { NotificationService } from './notification-service.service';
// DTO inline for speed or move to dto
class SendSmsDto {
  to: string;
  message: string;
  userId?: string;
  zoneId?: string;
  country?: string;
  region?: string;
}

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  getNotifications() {
    return this.notificationService.getNotifications();
  }

  @Post('sms')
  sendSms(@Body() dto: SendSmsDto) {
    return this.notificationService.sendSms(dto.to, dto.message, {
      userId: dto.userId,
      zoneId: dto.zoneId,
      country: dto.country,
      region: dto.region,
    });
  }
}
