
import { Controller, Get, UseGuards } from '@nestjs/common';
import { OcpiService } from './ocpi.service';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';

@Controller('ocpi')
@UseGuards(JwtAuthGuard)
export class OcpiPartnersController {
    constructor(private readonly ocpiService: OcpiService) { }

    @Get('partners')
    async findAll() {
        return this.ocpiService.findAllPartners();
    }

    @Get('actions/roaming-sessions')
    async getRoamingSessions() {
        const sessions = await this.ocpiService.getRoamingSessions();
        // Transform to match RoamingSession interface if needed, or do it on frontend
        return sessions.map(s => ({
            id: s.sessionId,
            role: 'CPO', // Simplified, actual logic depends on who we are in this session
            partner: s.partyId,
            site: 'Unknown', // Need location data
            start: (s.data as any).start_date_time,
            end: (s.data as any).end_date_time,
            kwh: (s.data as any).kwh,
            status: (s.data as any).status,
            // ... map other fields from data json
        }));
    }

    @Get('actions/roaming-cdrs')
    async getRoamingCdrs() {
        const cdrs = await this.ocpiService.getRoamingCdrs();
        return cdrs.map(c => ({
            cdr: c.cdrId,
            // ... map data
        }));
    }
}
