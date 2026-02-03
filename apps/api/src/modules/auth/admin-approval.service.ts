import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AdminApprovalService {
    private readonly logger = new Logger(AdminApprovalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly mailService: MailService,
    ) { }

    /**
     * Get all pending user applications
     */
    async getPendingApplications() {
        return this.prisma.userApplication.findMany({
            where: { status: 'PENDING' },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        createdAt: true,
                    },
                },
            },
            orderBy: { submittedAt: 'desc' },
        });
    }

    /**
     * Get specific application details including documents
     */
    async getApplicationById(id: string) {
        const application = await this.prisma.userApplication.findUnique({
            where: { id },
            include: {
                user: true,
                reviewer: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });

        if (!application) {
            throw new NotFoundException('Application not found');
        }

        return application;
    }

    /**
     * Approve a user application
     */
    async approveApplication(applicationId: string, adminId: string, notes?: string) {
        const application = await this.getApplicationById(applicationId);

        if (application.status !== 'PENDING') {
            throw new ForbiddenException('Application has already been reviewed');
        }

        // Update application status
        const updatedApplication = await this.prisma.userApplication.update({
            where: { id: applicationId },
            data: {
                status: 'APPROVED',
                reviewedBy: adminId,
                reviewedAt: new Date(),
                adminNotes: notes,
            },
            include: { user: true },
        });

        // Activate the user
        await this.prisma.user.update({
            where: { id: application.userId },
            data: { status: 'Active' },
        });

        // Send approval email
        try {
            if (application.user.email) {
                await this.mailService.sendApplicationApprovedEmail(application.user.email, application.user.name);
            }
        } catch (error) {
            this.logger.error('Failed to send approval email', String(error).replace(/[\n\r]/g, ''));
        }

        this.logger.log(`Application ${applicationId} approved by admin ${adminId}`);
        return updatedApplication;
    }

    /**
     * Reject a user application
     */
    async rejectApplication(applicationId: string, adminId: string, reason: string, notes?: string) {
        const application = await this.getApplicationById(applicationId);

        if (application.status !== 'PENDING') {
            throw new ForbiddenException('Application has already been reviewed');
        }

        // Update application status
        const updatedApplication = await this.prisma.userApplication.update({
            where: { id: applicationId },
            data: {
                status: 'REJECTED',
                reviewedBy: adminId,
                reviewedAt: new Date(),
                rejectionReason: reason,
                adminNotes: notes,
            },
            include: { user: true },
        });

        // Update user status
        await this.prisma.user.update({
            where: { id: application.userId },
            data: { status: 'Rejected' },
        });

        // Send rejection email
        try {
            if (application.user.email) {
                await this.mailService.sendApplicationRejectedEmail(
                    application.user.email,
                    application.user.name,
                    reason
                );
            }
        } catch (error) {
            this.logger.error('Failed to send rejection email', String(error).replace(/[\n\r]/g, ''));
        }

        this.logger.log(`Application ${applicationId} rejected by admin ${adminId}`);
        return updatedApplication;
    }

    /**
     * Create a user application during registration
     */
    async createApplication(data: {
        userId: string;
        companyName?: string;
        taxId?: string;
        country: string;
        region: string;
        accountType: string;
        role: string;
        subscribedPackage?: string;
    }) {
        return this.prisma.userApplication.create({
            data: {
                userId: data.userId,
                companyName: data.companyName,
                taxId: data.taxId,
                country: data.country,
                region: data.region,
                accountType: data.accountType,
                role: data.role,
                subscribedPackage: data.subscribedPackage,
                status: 'PENDING',
            },
        });
    }
}
