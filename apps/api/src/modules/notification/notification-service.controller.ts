import { Controller, Get, Post, Body } from '@nestjs/common';
import { NotificationService } from './notification-service.service';
// DTO inline for speed or move to dto
class SendSmsDto {
  to: string;
  message: string;
}

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) { }

  @Get()
  getHello() {
    return this.notificationService.getHello();
  }

  @Post('sms')
  sendSms(@Body() dto: SendSmsDto) {
    return this.notificationService.sendSms(dto.to, dto.message);
  }
}
