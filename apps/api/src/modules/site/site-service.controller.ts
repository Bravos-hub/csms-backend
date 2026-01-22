import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';
import { CreateSiteDocumentDto } from './dto/document.dto';
import { SiteService } from './site-service.service';

@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) { }

  @Post()
  create(@Body() createDto: CreateSiteDto) {
    return this.siteService.createSite(createDto);
  }

  @Get()
  findAll() {
    return this.siteService.findAllSites();
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
  createDocument(@Param('id') id: string, @Body() createDto: CreateSiteDocumentDto) {
    return this.siteService.createSiteDocument(id, createDto);
  }

  @Delete(':siteId/documents/:documentId')
  deleteDocument(@Param('documentId') documentId: string) {
    return this.siteService.deleteSiteDocument(documentId);
  }
}
