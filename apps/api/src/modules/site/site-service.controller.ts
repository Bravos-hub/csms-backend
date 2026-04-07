import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateSiteDto, SitePurpose, UpdateSiteDto } from './dto/site.dto';
import { CreateSiteDocumentDto } from './dto/document.dto';
import { SiteService } from './site-service.service';

@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Post()
  create(@Body() createDto: CreateSiteDto) {
    return this.siteService.createSite(createDto);
  }

  @Get()
  findAll(
    @Query('purpose') purpose?: SitePurpose,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.siteService.findAllSites({ purpose, limit, offset });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.siteService.findSiteById(id);
  }

  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.siteService.getSiteStats(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateSiteDto) {
    return this.siteService.updateSite(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.siteService.removeSite(id);
  }

  // Document endpoints
  @Get(':id/documents')
  getDocuments(@Param('id') id: string) {
    return this.siteService.findSiteDocuments(id);
  }

  @Post(':id/documents')
  createDocument(
    @Param('id') id: string,
    @Body() createDto: CreateSiteDocumentDto,
  ) {
    return this.siteService.createSiteDocument(id, createDto);
  }

  @Delete(':siteId/documents/:documentId')
  deleteDocument(@Param('documentId') documentId: string) {
    return this.siteService.deleteSiteDocument(documentId);
  }
}
