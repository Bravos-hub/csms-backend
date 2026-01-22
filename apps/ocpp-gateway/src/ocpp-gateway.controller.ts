import { Controller, Get } from '@nestjs/common';
import { OcppGatewayService } from './ocpp-gateway.service';

@Controller()
export class OcppGatewayController {
  constructor(private readonly ocppGatewayService: OcppGatewayService) { }

  @Get()
  healthCheck(): string {
    return 'OCPP Gateway Active';
  }
}
