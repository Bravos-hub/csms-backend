import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  CreateApplicationDto,
  UpdateApplicationStatusDto,
  UpdateApplicationTermsDto,
  ReviewApplicationDto,
  RequestInfoDto,
} from './dto/application.dto';
import {
  CreateNegotiationDto,
  CounterProposalDto,
  AcceptProposalDto,
  RejectProposalDto,
} from './dto/negotiation.dto';
import { SignLeaseDto, VerifyLeaseDto } from './dto/lease.dto';
import { DocumentsService } from '../documents/documents.service';
import {
  EntityType as DtoEntityType,
  DocumentCategory as DtoDocumentCategory,
} from '../documents/dto/upload-document.dto';
import { SignatureService } from './signature.service';

const tenantApplicationWithSiteInclude =
  Prisma.validator<Prisma.TenantApplicationInclude>()({
    site: true,
  });

const tenantApplicationWithDetailsInclude =
  Prisma.validator<Prisma.TenantApplicationInclude>()({
    site: true,
    negotiationRounds: {
      orderBy: { createdAt: 'desc' },
    },
  });

type TenantApplicationWithSite = Prisma.TenantApplicationGetPayload<{
  include: typeof tenantApplicationWithSiteInclude;
}>;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly signatureService: SignatureService,
  ) {}

  private parseArray(value?: string | null): string[] {
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return [];
    }
  }

  private jsonArray(value?: string[]): string | undefined {
    if (!value) return undefined;
    return JSON.stringify(value);
  }

  private toIso(value?: Date | null): string | undefined {
    return value?.toISOString();
  }

  private isJsonObject(
    value: Prisma.JsonValue | null | undefined,
  ): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getNumberField(
    value: Prisma.JsonObject,
    field: string,
  ): number | undefined {
    const raw = value[field];
    return typeof raw === 'number' ? raw : undefined;
  }

  private calculateSecurityDeposit(
    negotiatedTerms: Prisma.JsonValue | null | undefined,
  ): number {
    if (!this.isJsonObject(negotiatedTerms)) {
      return 0;
    }
    const securityDepositMonths = this.getNumberField(
      negotiatedTerms,
      'securityDepositMonths',
    );
    const monthlyRent = this.getNumberField(negotiatedTerms, 'monthlyRent');
    if (securityDepositMonths === undefined || monthlyRent === undefined) {
      return 0;
    }
    return securityDepositMonths * monthlyRent;
  }

  private mapApplication(application: TenantApplicationWithSite) {
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
      respondedAt: this.toIso(application.respondedAt),
      responseMessage: application.responseMessage,
      reviewedBy: application.reviewedBy,
      reviewedAt: this.toIso(application.reviewedAt),
      approvalNotes: application.approvalNotes,
      leaseAgreementUrl: application.leaseAgreementUrl,
      leaseSignedAt: this.toIso(application.leaseSignedAt),
      leaseStartDate: this.toIso(application.leaseStartDate),
      leaseEndDate: this.toIso(application.leaseEndDate),
    };
  }

  async create(applicantId: string, createDto: CreateApplicationDto) {
    const site = await this.prisma.site.findUnique({
      where: { id: createDto.siteId },
    });
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
        status: ApplicationStatus.PENDING_REVIEW,
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async findAll(filters?: { status?: ApplicationStatus; siteId?: string }) {
    const where: Prisma.TenantApplicationWhereInput = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.siteId) {
      where.siteId = filters.siteId;
    }

    const applications = await this.prisma.tenantApplication.findMany({
      where,
      include: tenantApplicationWithSiteInclude,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return applications.map((application) => this.mapApplication(application));
  }

  async findOne(id: string) {
    const application = await this.prisma.tenantApplication.findUnique({
      where: { id },
      include: tenantApplicationWithDetailsInclude,
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    return {
      ...this.mapApplication(application),
      negotiationRounds: application.negotiationRounds,
      negotiatedTerms: application.negotiatedTerms,
    };
  }

  async updateStatus(id: string, updateDto: UpdateApplicationStatusDto) {
    await this.findOne(id);

    return this.prisma.tenantApplication.update({
      where: { id },
      data: {
        status: updateDto.status,
        responseMessage: updateDto.message,
        respondedAt: new Date(),
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async reviewApplication(
    id: string,
    reviewDto: ReviewApplicationDto,
    reviewerId: string,
  ) {
    await this.findOne(id);

    return this.prisma.tenantApplication.update({
      where: { id },
      data: {
        status: reviewDto.status,
        approvalNotes: reviewDto.notes,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async requestInfo(
    id: string,
    requestDto: RequestInfoDto,
    reviewerId: string,
  ) {
    await this.findOne(id);

    return this.prisma.tenantApplication.update({
      where: { id },
      data: {
        status: ApplicationStatus.INFO_REQUESTED,
        responseMessage: requestDto.message,
        reviewedBy: reviewerId,
        respondedAt: new Date(),
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async updateTerms(id: string, updateDto: UpdateApplicationTermsDto) {
    await this.findOne(id);

    const chargingTechnology = this.jsonArray(updateDto.chargingTechnology);
    const targetCustomerSegment = this.jsonArray(
      updateDto.targetCustomerSegment,
    );

    return this.prisma.tenantApplication.update({
      where: { id },
      data: {
        proposedRent: updateDto.proposedRent,
        proposedTerm: updateDto.proposedTerm,
        numberOfChargingPoints: updateDto.numberOfChargingPoints,
        totalPowerRequirement: updateDto.totalPowerRequirement,
        chargingTechnology: chargingTechnology || '[]',
        targetCustomerSegment: targetCustomerSegment || '[]',
        status: ApplicationStatus.NEGOTIATING,
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async getNegotiations(id: string) {
    return this.prisma.negotiationRound.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        proposer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async proposeTerms(id: string, dto: CreateNegotiationDto, userId: string) {
    const application = await this.findOne(id);
    const terms = dto.terms as unknown as Prisma.InputJsonValue;

    const round = await this.prisma.negotiationRound.create({
      data: {
        applicationId: id,
        proposedBy: userId,
        terms,
        message: dto.message,
        status: 'PROPOSED',
      },
    });

    if (application.status !== ApplicationStatus.NEGOTIATING) {
      await this.prisma.tenantApplication.update({
        where: { id },
        data: { status: ApplicationStatus.NEGOTIATING },
      });
    }

    return round;
  }

  async counterProposal(
    id: string,
    roundId: string,
    dto: CounterProposalDto,
    userId: string,
  ) {
    const previousRound = await this.prisma.negotiationRound.findUnique({
      where: { id: roundId },
    });
    if (!previousRound) {
      throw new NotFoundException('Negotiation round not found');
    }

    await this.prisma.negotiationRound.update({
      where: { id: roundId },
      data: {
        status: 'COUNTERED',
        respondedBy: userId,
        respondedAt: new Date(),
      },
    });

    const terms = dto.terms as unknown as Prisma.InputJsonValue;
    return this.prisma.negotiationRound.create({
      data: {
        applicationId: id,
        proposedBy: userId,
        terms,
        message: dto.message,
        status: 'PROPOSED',
      },
    });
  }

  async acceptProposal(
    id: string,
    roundId: string,
    dto: AcceptProposalDto,
    userId: string,
  ) {
    const round = await this.prisma.negotiationRound.findUnique({
      where: { id: roundId },
    });
    if (!round) throw new NotFoundException('Negotiation round not found');

    const updatedRound = await this.prisma.negotiationRound.update({
      where: { id: roundId },
      data: {
        status: 'ACCEPTED',
        respondedBy: userId,
        respondedAt: new Date(),
        message: dto.message
          ? `${round.message || ''}\n[ACCEPTANCE NOTE]: ${dto.message}`
          : round.message,
      },
    });

    await this.prisma.tenantApplication.update({
      where: { id },
      data: {
        status: ApplicationStatus.TERMS_AGREED,
        negotiatedTerms: round.terms ?? undefined,
        termsAgreedAt: new Date(),
      },
    });

    return updatedRound;
  }

  async rejectProposal(
    id: string,
    roundId: string,
    dto: RejectProposalDto,
    userId: string,
  ) {
    const round = await this.prisma.negotiationRound.findUnique({
      where: { id: roundId },
    });
    if (!round) throw new NotFoundException('Negotiation round not found');

    return this.prisma.negotiationRound.update({
      where: { id: roundId },
      data: {
        status: 'REJECTED',
        respondedBy: userId,
        respondedAt: new Date(),
        message: dto.reason
          ? `${round.message || ''}\n[REJECTION REASON]: ${dto.reason}`
          : round.message,
      },
    });
  }

  async generateLease(id: string) {
    await this.findOne(id);

    const leaseUrl =
      'https://res.cloudinary.com/demo/image/upload/v1611095786/sample_lease_agreement.pdf';

    return this.prisma.tenantApplication.update({
      where: { id },
      data: {
        leaseAgreementUrl: leaseUrl,
        status: ApplicationStatus.LEASE_DRAFTING,
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async sendLeaseForSignature(id: string) {
    const application = await this.findOne(id);

    if (!application.leaseAgreementUrl) {
      throw new BadRequestException(
        'No lease agreement found. Generate a lease first.',
      );
    }

    if (!application.contactEmail || !application.contactPersonName) {
      throw new BadRequestException('Applicant contact details missing.');
    }

    this.signatureService.sendForSignature(
      id,
      application.contactEmail,
      application.contactPersonName,
      application.leaseAgreementUrl,
    );

    return this.prisma.tenantApplication.update({
      where: { id },
      data: {
        status: ApplicationStatus.LEASE_PENDING_SIGNATURE,
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async uploadSignedLease(
    id: string,
    file: Express.Multer.File,
    userId: string = 'system',
  ) {
    await this.findOne(id);

    const docRecord = await this.documentsService.uploadFile(
      file,
      {
        entityType: DtoEntityType.APPLICATION,
        entityId: id,
        category: DtoDocumentCategory.EXECUTED_LEASE,
        isRequired: true,
      },
      userId,
    );

    return this.prisma.tenantApplication.update({
      where: { id },
      data: {
        leaseAgreementUrl: docRecord.fileUrl,
        leaseSignedAt: new Date(),
        status: ApplicationStatus.LEASE_SIGNED,
      },
      include: tenantApplicationWithSiteInclude,
    });
  }

  async getLease(id: string) {
    const application = await this.prisma.tenantApplication.findUnique({
      where: { id },
    });
    if (!application) throw new NotFoundException('Application not found');
    return {
      leaseUrl: application.leaseAgreementUrl,
      status: application.status,
      signedByOwner: !!application.leaseSignedAt,
      signedByOperator: !!application.leaseSignedAt,
    };
  }

  async signLeaseOwner(id: string, dto: SignLeaseDto) {
    try {
      return await this.prisma.tenantApplication.update({
        where: { id },
        data: {
          leaseAgreementUrl: dto.signedLeaseUrl,
        },
        include: tenantApplicationWithSiteInclude,
      });
    } catch {
      throw new BadRequestException('Failed to sign lease as owner');
    }
  }

  async signLeaseOperator(id: string, dto: SignLeaseDto) {
    try {
      return await this.prisma.tenantApplication.update({
        where: { id },
        data: {
          leaseAgreementUrl: dto.signedLeaseUrl,
          leaseSignedAt: new Date(),
          status: ApplicationStatus.LEASE_SIGNED,
        },
        include: tenantApplicationWithSiteInclude,
      });
    } catch {
      throw new BadRequestException('Failed to sign lease as operator');
    }
  }

  async verifySecurityDeposit(id: string) {
    const application = await this.findOne(id);
    const depositAmount = this.calculateSecurityDeposit(
      application.negotiatedTerms,
    );

    try {
      return await this.prisma.tenantApplication.update({
        where: { id },
        data: {
          status: ApplicationStatus.DEPOSIT_PAID,
          depositPaidAt: new Date(),
          securityDepositAmount: depositAmount,
        },
        include: tenantApplicationWithSiteInclude,
      });
    } catch {
      throw new BadRequestException('Failed to verify security deposit');
    }
  }

  async verifyLease(id: string, dto: VerifyLeaseDto) {
    try {
      return await this.prisma.tenantApplication.update({
        where: { id },
        data: {
          status:
            dto.status === 'VERIFIED'
              ? ApplicationStatus.COMPLIANCE_CHECK
              : ApplicationStatus.LEASE_DRAFTING,
        },
      });
    } catch {
      throw new BadRequestException('Failed to verify lease');
    }
  }

  async activate(id: string) {
    const application = await this.findOne(id);

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updatedApp = await tx.tenantApplication.update({
            where: { id },
            data: {
              status: ApplicationStatus.COMPLETED,
              completedAt: new Date(),
            },
            include: tenantApplicationWithSiteInclude,
          });

          const tenant = await tx.siteTenant.create({
            data: {
              name: application.organizationName,
              type: 'CPO',
              status: 'Active',
              siteId: application.siteId,
              startDate: new Date(),
            },
          });

          return { application: updatedApp, tenant };
        },
      );
    } catch {
      throw new BadRequestException('Failed to activate application');
    }
  }
}
