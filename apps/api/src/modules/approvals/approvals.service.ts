import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export type ApprovalType = 'KYC' | 'ACCESS_REQUEST' | 'DOCUMENT_VERIFICATION' | 'TENANT_APPLICATION';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ApprovalItem = {
    id: string;
    type: ApprovalType;
    applicantId: string;
    applicantName: string;
    resourceId?: string;
    details: any;
    status: ApprovalStatus;
    submittedAt: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    reviewNotes?: string;
};

@Injectable()
export class ApprovalsService {
    constructor(private readonly prisma: PrismaService) { }

    async getPendingApprovals(filters?: { type?: ApprovalType }): Promise<ApprovalItem[]> {
        // TODO: Implement when schema has KYC and Application models
        // For now, return empty array
        // This will be populated when the following fields are added to the schema:
        // - User.kycStatus, User.kycSubmittedAt, User.kycDocuments, User.kycReviewedAt, User.kycReviewedBy, User.kycReviewNotes
        // - Application model with status, applicant, businessName, businessType, submittedAt, reviewedAt, reviewedBy, reviewNotes
        return [];
    }

    async approveKyc(userId: string, reviewedBy: string, notes?: string) {
        // TODO: Implement when User model has KYC fields
        // For now, just update the user to mark as processed
        return this.prisma.user.update({
            where: { id: userId },
            data: {
                // kycStatus: 'APPROVED', // Add when field exists
                updatedAt: new Date(),
            },
        });
    }

    async rejectKyc(userId: string, reviewedBy: string, notes: string) {
        // TODO: Implement when User model has KYC fields
        return this.prisma.user.update({
            where: { id: userId },
            data: {
                // kycStatus: 'REJECTED', // Add when field exists
                updatedAt: new Date(),
            },
        });
    }

    async approveApplication(applicationId: string, reviewedBy: string, notes?: string) {
        // TODO: Implement when Application model exists
        // For now, return a placeholder response
        return { id: applicationId, status: 'APPROVED', reviewedBy, notes };
    }

    async rejectApplication(applicationId: string, reviewedBy: string, notes: string) {
        // TODO: Implement when Application model exists
        // For now, return a placeholder response
        return { id: applicationId, status: 'REJECTED', reviewedBy, notes };
    }
}
