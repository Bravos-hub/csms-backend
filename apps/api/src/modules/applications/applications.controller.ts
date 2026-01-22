import { Body, Controller, Get, Param, Patch, Post, Query, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto, UpdateApplicationStatusDto, UpdateApplicationTermsDto, ReviewApplicationDto, RequestInfoDto } from './dto/application.dto';
import { CreateNegotiationDto, CounterProposalDto, AcceptProposalDto, RejectProposalDto } from './dto/negotiation.dto';
import { SignLeaseDto, VerifyLeaseDto } from './dto/lease.dto';
import { ApplicationStatus } from '@prisma/client';

@Controller('applications')
export class ApplicationsController {
    constructor(private readonly applicationsService: ApplicationsService) { }

    @Get()
    findAll(@Query() query: { status?: ApplicationStatus; siteId?: string }) {
        return this.applicationsService.findAll(query);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.applicationsService.findOne(id);
    }

    @Post()
    create(@Body() createDto: CreateApplicationDto, @Request() req?: any) {
        // For now, use a mock applicant ID. In production, this would come from the authenticated user
        const applicantId = req?.user?.id || 'mock-id';
        return this.applicationsService.create(applicantId, createDto);
    }

    @Patch(':id/status')
    updateStatus(@Param('id') id: string, @Body() updateDto: UpdateApplicationStatusDto) {
        return this.applicationsService.updateStatus(id, updateDto);
    }

    @Patch(':id/review')
    reviewApplication(@Param('id') id: string, @Body() reviewDto: ReviewApplicationDto, @Request() req?: any) {
        const reviewerId = req?.user?.id || 'mock-admin-id';
        return this.applicationsService.reviewApplication(id, reviewDto, reviewerId);
    }

    @Patch(':id/request-info')
    requestInfo(@Param('id') id: string, @Body() requestDto: RequestInfoDto, @Request() req?: any) {
        const reviewerId = req?.user?.id || 'mock-admin-id';
        return this.applicationsService.requestInfo(id, requestDto, reviewerId);
    }

    @Patch(':id/terms')
    updateTerms(@Param('id') id: string, @Body() updateDto: UpdateApplicationTermsDto) {
        return this.applicationsService.updateTerms(id, updateDto);
    }

    // Negotiation Endpoints

    @Get(':id/negotiations')
    getNegotiations(@Param('id') id: string) {
        return this.applicationsService.getNegotiations(id);
    }

    @Post(':id/negotiations')
    proposeTerms(@Param('id') id: string, @Body() dto: CreateNegotiationDto, @Request() req?: any) {
        const userId = req?.user?.id || 'mock-id';
        return this.applicationsService.proposeTerms(id, dto, userId);
    }

    @Post(':id/negotiations/:roundId/counter')
    counterProposal(@Param('id') id: string, @Param('roundId') roundId: string, @Body() dto: CounterProposalDto, @Request() req?: any) {
        const userId = req?.user?.id || 'mock-id';
        return this.applicationsService.counterProposal(id, roundId, dto, userId);
    }

    @Post(':id/negotiations/:roundId/accept')
    acceptProposal(@Param('id') id: string, @Param('roundId') roundId: string, @Body() dto: AcceptProposalDto, @Request() req?: any) {
        const userId = req?.user?.id || 'mock-id';
        return this.applicationsService.acceptProposal(id, roundId, dto, userId);
    }

    @Post(':id/negotiations/:roundId/reject')
    rejectProposal(@Param('id') id: string, @Param('roundId') roundId: string, @Body() dto: RejectProposalDto, @Request() req?: any) {
        const userId = req?.user?.id || 'mock-id';
        return this.applicationsService.rejectProposal(id, roundId, dto, userId);
    }

    // Lease Endpoints

    @Post(':id/lease/generate')
    generateLease(@Param('id') id: string) {
        return this.applicationsService.generateLease(id);
    }

    @Post(':id/lease/send-signature')
    sendLeaseForSignature(@Param('id') id: string) {
        return this.applicationsService.sendLeaseForSignature(id);
    }

    @Post(':id/lease/upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadSignedLease(
        @Param('id') id: string,
        @UploadedFile() file: Express.Multer.File,
        @Request() req: any,
    ) {
        if (!file) {
            throw new Error('No file uploaded');
        }

        const userId = req?.user?.id || 'system';
        return this.applicationsService.uploadSignedLease(id, file, userId);
    }

    @Post(':id/deposit/verify')
    verifySecurityDeposit(@Param('id') id: string) {
        return this.applicationsService.verifySecurityDeposit(id);
    }

    @Get(':id/lease')
    getLease(@Param('id') id: string) {
        return this.applicationsService.getLease(id);
    }

    @Post(':id/lease/sign/owner')
    signLeaseOwner(@Param('id') id: string, @Body() dto: SignLeaseDto) {
        return this.applicationsService.signLeaseOwner(id, dto);
    }

    @Post(':id/lease/sign/operator')
    signLeaseOperator(@Param('id') id: string, @Body() dto: SignLeaseDto) {
        return this.applicationsService.signLeaseOperator(id, dto);
    }

    @Patch(':id/lease/verify')
    verifyLease(@Param('id') id: string, @Body() dto: VerifyLeaseDto) {
        return this.applicationsService.verifyLease(id, dto);
    }

    @Post(':id/activate')
    activate(@Param('id') id: string) {
        return this.applicationsService.activate(id);
    }
}
