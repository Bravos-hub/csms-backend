import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TechniciansService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.technicianAvailability.findMany({
            include: {
                user: {
                    select: { id: true, name: true, phone: true },
                },
            },
            orderBy: { lastPulse: 'desc' },
        });
    }

    async updateStatus(userId: string, data: { status: string; location?: string }) {
        return this.prisma.technicianAvailability.upsert({
            where: { userId },
            update: {
                status: data.status,
                location: data.location,
                lastPulse: new Date(),
            },
            create: {
                userId,
                status: data.status,
                location: data.location,
            },
        });
    }

    async getAssignment(userId: string) {
        // Find if the user has an assigned station as 'ATTENDANT' or explicit assignment
        // For now, we check the 'technicianStatus' location or if they own/operate one.
        // Assuming location store stationId or we look up stations where operatorId = userId
        // But for technician, let's use a new query or use 'technicianStatus.location' as rudimentary stationId if formatted as such, 
        // OR better: Look for 'Station' where operatorId = userId or similar.
        // The mock 'StationAssignment' shows Shift and Attendant.

        // Let's assume we link via 'Station.operatorId' or similar for now.
        // Or if 'Job' has stationId, we can infer.

        // Simplest: Find a station where this user is an operator or attendant.
        const station = await this.prisma.station.findFirst({
            where: { operatorId: userId },
            include: {
                jobs: {
                    where: { status: { in: ['AVAILABLE', 'IN_PROGRESS'] } }
                },
                chargePoints: true,
            }
        });

        if (!station) return null;

        // Transform to mock format
        return {
            id: station.id,
            name: station.name,
            location: station.address,
            status: station.status.toLowerCase(),
            capability: station.type === 'SWAPPING' ? 'Swap' : station.type === 'CHARGING' ? 'Charge' : 'Both',
            shift: '08:00 - 16:00', // Hardcoded shift for now, or add to DB later
            attendant: 'You', // Or fetch user name
            metrics: [
                { label: 'Chargers available', value: `${station.chargePoints.filter(c => c.status === 'AVAILABLE').length} / ${station.chargePoints.length}`, tone: 'ok' },
                { label: 'Jobs Pending', value: `${station.jobs.length}`, tone: station.jobs.length > 0 ? 'warn' : 'ok' }
            ]
        };
    }

    async getJobs(userId: string) {
        // Return jobs assigned to this technician OR available at their assigned station
        // First find their station
        const station = await this.prisma.station.findFirst({
            where: { operatorId: userId }
        });

        const where: any = {
            OR: [
                { technicianId: userId }, // Directly assigned
            ]
        };

        if (station) {
            where.OR.push({
                stationId: station.id,
                technicianId: null, // Unassigned jobs at their station
                status: 'AVAILABLE'
            });
        }

        const jobs = await this.prisma.job.findMany({
            where,
            include: { station: true },
            orderBy: { createdAt: 'desc' }
        });

        return jobs.map(j => ({
            id: j.id,
            title: j.title,
            station: j.station.name,
            location: j.station.address,
            priority: j.priority,
            status: j.status,
            pay: j.pay,
            posted: j.createdAt.toISOString(), // Client can format relative time
            description: j.description
        }));
    }
}
