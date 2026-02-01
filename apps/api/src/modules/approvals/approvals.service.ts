
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export type ApprovalType = 'KYC' | 'ACCESS_REQUEST' | 'DOCUMENT_VERIFICATION' | 'TENANT_APPLICATION';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ApprovalItem = {
    id: string;
    type: string;
    applicantId: string;
    applicantName: string; // This needs to be fetched or stored
    resourceId?: string;
    details: any;
    status: string;
    submittedAt: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    reviewNotes?: string;
};

@Injectable()
export class ApprovalsService {
    constructor(private readonly prisma: PrismaService) { }

    async getPendingApprovals(filters?: { type?: ApprovalType }) {
        // Fetch pending requests
        // In a real app we would join with User to get applicantName.
        // For now we might just return the ID as name if we don't have the user relation handy in this query context easily without joining.
        // But let's try to get user info if possible or just return raw data.

        const requests = await this.prisma.approvalRequest.findMany({
            where: {
                status: 'PENDING',
                ...(filters?.type && { type: filters.type }),
            },
            orderBy: { submittedAt: 'desc' },
        });

        // Enrich with user data (mocked enrichment for performance/simplicity in this MVP)
        // Or better: fetch users.
        const userIds = [...new Set(requests.map(r => r.applicantId))];
        const users = await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
        });
        const userMap = new Map(users.map(u => [u.id, u]));

        return requests.map(req => {
            const user = userMap.get(req.applicantId);
            return {
                ...req,
                applicantName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown User',
            };
        });
    }

    async approveKyc(userId: string, reviewedBy: string, notes?: string) {
        // Find pending KYC request for user
        const request = await this.prisma.approvalRequest.findFirst({
            where: { applicantId: userId, type: 'KYC', status: 'PENDING' },
        });

        if (!request) {
            throw new NotFoundException(`No pending KYC request found for user ${userId}`);
        }

        return this.prisma.approvalRequest.update({
            where: { id: request.id },
            data: {
                status: 'APPROVED',
                reviewedBy,
                reviewNotes: notes,
                reviewedAt: new Date(),
            },
        });
    }

    async rejectKyc(userId: string, reviewedBy: string, notes: string) {
        const request = await this.prisma.approvalRequest.findFirst({
            where: { applicantId: userId, type: 'KYC', status: 'PENDING' },
        });

        if (!request) {
            throw new NotFoundException(`No pending KYC request found for user ${userId}`);
        }

        return this.prisma.approvalRequest.update({
            where: { id: request.id },
            data: {
                status: 'REJECTED',
                reviewedBy,
                reviewNotes: notes,
                reviewedAt: new Date(),
            },
        });
    }

    async approveApplication(applicationId: string, reviewedBy: string, notes?: string) {
        // Assuming applicationId is the resourceId or the approval request ID?
        // Let's assume passed ID is the ApprovalRequest ID for simplicity if feasible, 
        // OR filtering by resourceId if applicationId refers to TenantApplication.id
        // Frontend likely passes ID from the list.

        return this.prisma.approvalRequest.update({
            where: { id: applicationId },
            data: {
                status: 'APPROVED',
                reviewedBy,
                reviewNotes: notes,
                reviewedAt: new Date(),
            },
        });
    }

    async rejectApplication(applicationId: string, reviewedBy: string, notes: string) {
        return this.prisma.approvalRequest.update({
            where: { id: applicationId },
            data: {
                status: 'REJECTED',
                reviewedBy,
                reviewNotes: notes,
                reviewedAt: new Date(),
            },
        });
    }
}
