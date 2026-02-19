import { Transform } from 'class-transformer'
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator'
import { MarketplaceContactEntityKind, MarketplaceContactEventType } from '@prisma/client'

const toInt = ({ value }: { value: unknown }) => {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? value : parsed
}

export class CreateMarketplaceContactEventDto {
  @IsEnum(MarketplaceContactEntityKind)
  entityKind: MarketplaceContactEntityKind

  @IsString()
  entityId: string

  @IsEnum(MarketplaceContactEventType)
  eventType: MarketplaceContactEventType

  @IsOptional()
  @IsString()
  entityName?: string

  @IsOptional()
  @IsString()
  entityCity?: string

  @IsOptional()
  @IsString()
  entityRegion?: string

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class MarketplaceRecentContactsQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number
}
