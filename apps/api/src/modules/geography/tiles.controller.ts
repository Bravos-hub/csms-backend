import { Controller, Get, Param, Res, Header, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { GeographyService } from './geography.service';

@ApiTags('Geography')
@Controller('geography/tiles')
export class TilesController {
    constructor(private readonly geographyService: GeographyService) { }

    @Get(':z/:x/:y.pbf')
    @ApiOperation({ summary: 'Get Vector Tile (MVT) for stations' })
    @ApiParam({ name: 'z', type: 'number' })
    @ApiParam({ name: 'x', type: 'number' })
    @ApiParam({ name: 'y', type: 'number' })
    @ApiQuery({ name: 'status', required: false })
    @ApiQuery({ name: 'type', required: false })
    @ApiQuery({ name: 'region', required: false })
    @Header('Content-Type', 'application/x-protobuf')
    @Header('Cache-Control', 'public, max-age=3600')
    async getTile(
        @Param('z') z: string,
        @Param('x') x: string,
        @Param('y') y: string,
        @Query('status') status: string,
        @Query('type') type: string,
        @Query('region') region: string,
        @Res() res: Response,
    ) {
        const tile = await this.geographyService.getMvtTile(
            Number(z),
            Number(x),
            Number(y),
            { status, type, region }
        );

        if (!tile || tile.length === 0) {
            return res.status(204).send();
        }

        res.send(tile);
    }

    @Get('h3-density')
    @ApiOperation({ summary: 'Get H3 Hexagon density for stations' })
    @ApiQuery({ name: 'res', required: false, type: 'number', description: 'H3 Resolution (0-15)' })
    async getH3Density(@Query('res') resolution: string) {
        return this.geographyService.getH3Density(resolution ? Number(resolution) : 4);
    }
}
