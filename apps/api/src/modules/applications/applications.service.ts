import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateApplicationDto, UpdateApplicationStatusDto, UpdateApplicationTermsDto, ReviewApplicationDto, RequestInfoDto } from './dto/application.dto';
import { CreateNegotiationDto, CounterProposalDto, AcceptProposalDto, RejectProposalDto } from './dto/negotiation.dto';
import { SignLeaseDto, VerifyLeaseDto, RegisterLeaseDto } from './dto/lease.dto';
import { ApplicationStatus, DocumentCategory, EntityType } from '@prisma/client';
import { DocumentsService } from '../documents/documents.service';
import { EntityType as DtoEntityType, DocumentCategory as DtoDocumentCategory } from '../documents/dto/upload-document.dto';
import { SignatureService } from './signature.service';

@Injectable()
export class ApplicationsService {
    constructor(
        private prisma: PrismaService,
        private readonly documentsService: DocumentsService,
        private readonly signatureService: SignatureService
    ) { }

    private parseArray(value?: string) {
        if (!value) return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private jsonArray(value?: string[]) {
        if (!value) return undefined;
        return JSON.stringify(value);
    }

    async create(applicantId: string, createDto: CreateApplicationDto) {
        const site = await this.prisma.site.findUnique({ where: { id: createDto.siteId } });
        if (!site) throw new NotFoundException('Site not found');

        const additionalServices = this.jsonArray(createDto.additionalServices);

        return this.prisma.tenantApplication.create({
            data: {
                applicantId,
                organizationName: createDto.organizationName,
                businessRegistrationNumber: createDto.businessRegistrationNumber,
                taxComplianceNumber: createDto.taxComplianceNumber,
                contactPersonName: createDto.contactPersonName,
                contactEmail: createDto.contactEmail,
                contactPhone: createDto.contactPhone,
                physicalAddress: createDto.physicalAddress,
                companyWebsite: createDto.companyWebsite,
                yearsInEVBusiness: createDto.yearsInEVBusiness,
                existingStationsOperated: createDto.existingStationsOperated,
                siteId: createDto.siteId,
                preferredLeaseModel: createDto.preferredLeaseModel,
                businessPlanSummary: createDto.businessPlanSummary,
                sustainabilityCommitments: createDto.sustainabilityCommitments,
                additionalServices: additionalServices || '[]',
                estimatedStartDate: createDto.estimatedStartDate,
                message: createDto.message,
                status: ApplicationStatus.PENDING_REVIEW, // Auto-submit for now
            },
            include: {
                site: true,
            },
        });
    }

    async findAll(filters?: { status?: ApplicationStatus; siteId?: string }) {
        const where: any = {};

        if (filters?.status) {
            where.status = filters.status;
        }

        if (filters?.siteId) {
            where.siteId = filters.siteId;
        }

        const applications = await this.prisma.tenantApplication.findMany({
            where,
            include: {
                site: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Map to frontend format
        return applications.map((app: any) => ({
            id: app.id,
            applicantId: app.applicantId,
            applicantName: app.contactPersonName,
            organizationId: null,
            organizationName: app.organizationName,
            businessRegistrationNumber: app.businessRegistrationNumber,
            taxComplianceNumber: app.taxComplianceNumber,
            contactPersonName: app.contactPersonName,
            contactEmail: app.contactEmail,
            contactPhone: app.contactPhone,
            physicalAddress: app.physicalAddress,
            companyWebsite: app.companyWebsite,
            yearsInEVBusiness: app.yearsInEVBusiness,
            existingStationsOperated: app.existingStationsOperated,
            siteId: app.siteId,
            siteName: app.site.name,
            site: app.site,
            preferredLeaseModel: app.preferredLeaseModel,
            businessPlanSummary: app.businessPlanSummary,
            sustainabilityCommitments: app.sustainabilityCommitments,
            additionalServices: this.parseArray(app.additionalServices),
            estimatedStartDate: app.estimatedStartDate,
            proposedRent: app.proposedRent,
            proposedTerm: app.proposedTerm,
            numberOfChargingPoints: app.numberOfChargingPoints,
            totalPowerRequirement: app.totalPowerRequirement,
            chargingTechnology: this.parseArray(app.chargingTechnology),
            targetCustomerSegment: this.parseArray(app.targetCustomerSegment),
            status: app.status,
            message: app.message,
            createdAt: app.createdAt.toISOString(),
            submittedAt: app.createdAt.toISOString(),
            respondedAt: app.respondedAt?.toISOString(),
            responseMessage: app.responseMessage,
            reviewedBy: app.reviewedBy,
            reviewedAt: app.reviewedAt?.toISOString(),
            approvalNotes: app.approvalNotes,
            leaseAgreementUrl: app.leaseAgreementUrl,
            leaseSignedAt: app.leaseSignedAt?.toISOString(),
            leaseStartDate: app.leaseStartDate?.toISOString(),
            leaseEndDate: app.leaseEndDate?.toISOString(),
        }));
    }

    async findOne(id: string) {
        const application = await this.prisma.tenantApplication.findUnique({
            where: { id },
            include: {
                site: true,
                negotiationRounds: {
                    orderBy: { createdAt: 'desc' }
                }
            },
        });

        if (!application) {
            throw new NotFoundException('Application not found');
        }

        return {
            id: application.id,
            applicantId: application.applicantId,
            applicantName: application.contactPersonName,
            organizationId: null,
            organizationName: application.organizationName,
            businessRegistrationNumber: application.businessRegistrationNumber,
            taxComplianceNumber: application.taxComplianceNumber,
            contactPersonName: application.contactPersonName,
            contactEmail: application.contactEmail,
            contactPhone: application.contactPhone,
            physicalAddress: application.physicalAddress,
            companyWebsite: application.companyWebsite,
            yearsInEVBusiness: application.yearsInEVBusiness,
            existingStationsOperated: application.existingStationsOperated,
            siteId: application.siteId,
            siteName: application.site?.name || 'Unknown Site',
            site: application.site,
            preferredLeaseModel: application.preferredLeaseModel,
            businessPlanSummary: application.businessPlanSummary,
            sustainabilityCommitments: application.sustainabilityCommitments,
            additionalServices: this.parseArray(application.additionalServices),
            estimatedStartDate: application.estimatedStartDate,
            proposedRent: application.proposedRent,
            proposedTerm: application.proposedTerm,
            numberOfChargingPoints: application.numberOfChargingPoints,
            totalPowerRequirement: application.totalPowerRequirement,
            chargingTechnology: this.parseArray(application.chargingTechnology),
            targetCustomerSegment: this.parseArray(application.targetCustomerSegment),
            status: application.status,
            message: application.message,
            createdAt: application.createdAt.toISOString(),
            submittedAt: application.createdAt.toISOString(),
            respondedAt: application.respondedAt?.toISOString(),
            responseMessage: application.responseMessage,
            reviewedBy: application.reviewedBy,
            reviewedAt: application.reviewedAt?.toISOString(),
            approvalNotes: application.approvalNotes,
            leaseAgreementUrl: application.leaseAgreementUrl,
            leaseSignedAt: application.leaseSignedAt?.toISOString(),
            leaseStartDate: application.leaseStartDate?.toISOString(),
            leaseEndDate: application.leaseEndDate?.toISOString(),
            negotiationRounds: application.negotiationRounds,
            negotiatedTerms: application.negotiatedTerms,
        };
    }

    async updateStatus(id: string, updateDto: UpdateApplicationStatusDto) {
        const application = await this.findOne(id);

        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                status: updateDto.status,
                responseMessage: updateDto.message,
                respondedAt: new Date(),
            },
            include: {
                site: true,
            },
        });
    }

    async reviewApplication(id: string, reviewDto: ReviewApplicationDto, reviewerId: string) {
        await this.findOne(id);

        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                status: reviewDto.status,
                approvalNotes: reviewDto.notes,
                reviewedBy: reviewerId,
                reviewedAt: new Date(),
                // If INFO_REQUESTED, we might want to store requiredDocuments somewhere
                // For now, storing in notes or specific field if schema supported it
            },
            include: { site: true }
        });
    }

    async requestInfo(id: string, requestDto: RequestInfoDto, reviewerId: string) {
        await this.findOne(id);

        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                status: ApplicationStatus.INFO_REQUESTED,
                responseMessage: requestDto.message, // Using responseMessage for communication
                reviewedBy: reviewerId,
                respondedAt: new Date(),
            },
            include: { site: true }
        });
    }

    async updateTerms(id: string, updateDto: UpdateApplicationTermsDto) {
        const application = await this.findOne(id);

        const chargingTechnology = this.jsonArray(updateDto.chargingTechnology);
        const targetCustomerSegment = this.jsonArray(updateDto.targetCustomerSegment);

        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                proposedRent: updateDto.proposedRent,
                proposedTerm: updateDto.proposedTerm,
                numberOfChargingPoints: updateDto.numberOfChargingPoints,
                totalPowerRequirement: updateDto.totalPowerRequirement,
                chargingTechnology: chargingTechnology || '[]',
                targetCustomerSegment: targetCustomerSegment || '[]',
                status: ApplicationStatus.NEGOTIATING, // Auto-transition to Negotiating
            },
            include: {
                site: true,
            },
        });
    }

    // Negotiation Methods

    async getNegotiations(id: string) {
        return this.prisma.negotiationRound.findMany({
            where: { applicationId: id },
            orderBy: { createdAt: 'desc' },
            include: {
                proposer: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });
    }

    async proposeTerms(id: string, dto: CreateNegotiationDto, userId: string) {
        const application = await this.findOne(id);

        // Create negotiation round
        const round = await this.prisma.negotiationRound.create({
            data: {
                applicationId: id,
                proposedBy: userId,
                terms: JSON.parse(JSON.stringify(dto.terms)), // Ensure JSON compatibility
                message: dto.message,
                status: 'PROPOSED'
            }
        });

        // Update application status if needed
        if (application.status !== ApplicationStatus.NEGOTIATING) {
            await this.prisma.tenantApplication.update({
                where: { id },
                data: { status: ApplicationStatus.NEGOTIATING }
            });
        }

        return round;
    }

    async counterProposal(id: string, roundId: string, dto: CounterProposalDto, userId: string) {
        const previousRound = await this.prisma.negotiationRound.findUnique({ where: { id: roundId } });
        if (!previousRound) throw new NotFoundException('Negotiation round not found');

        // Mark previous round as responded (COUNTERED could be a status update here if we want strictly one active)
        // For history tracking, we assume creating a NEW round is the counter.
        // Optionally update the previous round to indicate it was countered.
        await this.prisma.negotiationRound.update({
            where: { id: roundId },
            data: {
                status: 'COUNTERED',
                respondedBy: userId,
                respondedAt: new Date()
            }
        });

        // Create new round with counter terms
        return this.prisma.negotiationRound.create({
            data: {
                applicationId: id,
                proposedBy: userId,
                terms: JSON.parse(JSON.stringify(dto.terms)),
                message: dto.message,
                status: 'PROPOSED' // It's a new proposal in the chain
            }
        });
    }

    async acceptProposal(id: string, roundId: string, dto: AcceptProposalDto, userId: string) {
        const round = await this.prisma.negotiationRound.findUnique({ where: { id: roundId } });
        if (!round) throw new NotFoundException('Negotiation round not found');

        // Update round status
        const updatedRound = await this.prisma.negotiationRound.update({
            where: { id: roundId },
            data: {
                status: 'ACCEPTED',
                respondedBy: userId,
                respondedAt: new Date(),
                message: dto.message ? `${round.message || ''}\n[ACCEPTANCE NOTE]: ${dto.message}` : round.message
            }
        });

        // Update Application to TERMS_AGREED and save final terms
        await this.prisma.tenantApplication.update({
            where: { id },
            data: {
                status: ApplicationStatus.TERMS_AGREED,
                negotiatedTerms: round.terms ?? undefined,
                termsAgreedAt: new Date()
            }
        });

        return updatedRound;
    }

    async rejectProposal(id: string, roundId: string, dto: RejectProposalDto, userId: string) {
        const round = await this.prisma.negotiationRound.findUnique({ where: { id: roundId } });
        if (!round) throw new NotFoundException('Negotiation round not found');

        return this.prisma.negotiationRound.update({
            where: { id: roundId },
            data: {
                status: 'REJECTED',
                respondedBy: userId,
                respondedAt: new Date(),
                message: dto.reason ? `${round.message || ''}\n[REJECTION REASON]: ${dto.reason}` : round.message
            }
        });
    }
    // Lease Methods

    async generateLease(id: string) {
        const application = await this.findOne(id);

        // In a real implementation, this would generate a PDF based on application.negotiatedTerms
        // For now, we return a mock URL or a placeholder
        const leaseUrl = 'https://res.cloudinary.com/demo/image/upload/v1611095786/sample_lease_agreement.pdf';

        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                leaseAgreementUrl: leaseUrl,
                status: ApplicationStatus.LEASE_DRAFTING, // Or PENDING_SIGNATURE
            },
            include: { site: true }
        });
    }

    async sendLeaseForSignature(id: string) {
        const application = await this.findOne(id);

        if (!application.leaseAgreementUrl) {
            throw new BadRequestException('No lease agreement found. Generate a lease first.');
        }

        if (!application.contactEmail || !application.contactPersonName) {
            throw new BadRequestException('Applicant contact details missing.');
        }

        // Send for signature (DocuSign or Simulation)
        // await this.signatureService.sendForSignature(
        //     id,
        //     application.contactEmail,
        //     application.contactPersonName,
        //     application.leaseAgreementUrl
        // );
        console.log(`[Mock Signature] Sending lease to ${application.contactEmail} for signature.`);

        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                status: ApplicationStatus.LEASE_PENDING_SIGNATURE,
            },
            include: { site: true }
        });
    }

    async uploadSignedLease(id: string, file: Express.Multer.File, userId: string = 'system') {
        const application = await this.findOne(id);

        // Upload to Cloudinary via DocumentsService
        const docRecord = await this.documentsService.uploadFile(file, {
            entityType: DtoEntityType.APPLICATION,
            entityId: id,
            category: DtoDocumentCategory.EXECUTED_LEASE,
            isRequired: true
        }, userId);

        // Upload the signed lease document and update status
        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                leaseAgreementUrl: docRecord.fileUrl,
                leaseSignedAt: new Date(),
                status: ApplicationStatus.LEASE_SIGNED,
            },
            include: { site: true }
        });
    }

    async getLease(id: string) {
        const application = await this.prisma.tenantApplication.findUnique({ where: { id } });
        if (!application) throw new NotFoundException('Application not found');
        return {
            leaseUrl: application.leaseAgreementUrl,
            status: application.status,
            signedByOwner: !!application.leaseSignedAt, // Simplified
            signedByOperator: !!application.leaseSignedAt,
        };
    }

    async signLeaseOwner(id: string, dto: SignLeaseDto) {
        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                leaseAgreementUrl: dto.signedLeaseUrl,
            },
            include: { site: true }
        });
    }

    async signLeaseOperator(id: string, dto: SignLeaseDto) {
        return this.prisma.tenantApplication.update({
            where: { id },
            data: {
                leaseAgreementUrl: dto.signedLeaseUrl,
                leaseSignedAt: new Date(),
                status: ApplicationStatus.LEASE_SIGNED
            },
            include: { site: true }
        });
    }

    async verifySecurityDeposit(id: string) {
        const application = await this.findOne(id);

        // Ensure we have a negotiated amount
        const terms = application.negotiatedTerms as any;
        const depositAmount = terms?.securityDepositMonths && terms?.monthlyRent
            ? terms.securityDepositMonths * terms.monthlyRent
            : 0;

        try {
            return await this.prisma.tenantApplication.update({
                where: { id },
                data: {
                    status: ApplicationStatus.DEPOSIT_PAID,
                    depositPaidAt: new Date(),
                    securityDepositAmount: depositAmount,
                },
                include: { site: true }
            });
        } catch (error) {
            throw new BadRequestException('Failed to verify security deposit');
        }
    }

    async verifyLease(id: string, dto: VerifyLeaseDto) {
        try {
            return await this.prisma.tenantApplication.update({
                where: { id },
                data: {
                    status: dto.status === 'VERIFIED' ? ApplicationStatus.COMPLIANCE_CHECK : ApplicationStatus.LEASE_DRAFTING,
                    // approvalNotes: dto.notes - if we want to store notes
                }
            });
        } catch (error) {
            throw new BadRequestException('Failed to verify lease');
        }
    }

    async activate(id: string) {
        const application = await this.findOne(id);

        // Ideally check status is DEPOSIT_PAID or LEASE_SIGNED
        // if (application.status !== ApplicationStatus.DEPOSIT_PAID) ...

        try {
            return await this.prisma.$transaction(async (prisma: any) => {
                // 1. Update Application Status
                const updatedApp = await prisma.tenantApplication.update({
                    where: { id },
                    data: {
                        status: ApplicationStatus.COMPLETED,
                        completedAt: new Date(),
                    },
                    include: { site: true }
                });

                // 2. Create Tenant Record
                const tenant = await prisma.tenant.create({
                    data: {
                        name: application.organizationName,
                        type: 'CPO', // Charge Point Operator
                        status: 'Active',
                        siteId: application.siteId,
                        startDate: new Date(),
                    }
                });

                return { application: updatedApp, tenant };
            });
        } catch (error) {
            throw new BadRequestException('Failed to activate application');
        }
    }
}
