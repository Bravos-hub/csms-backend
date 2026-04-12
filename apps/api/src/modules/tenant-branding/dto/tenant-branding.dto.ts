import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export const BRANDING_ASSET_KINDS = [
  'logo',
  'logoIcon',
  'favicon',
  'loginIllustration',
] as const;

export type BrandingAssetKind = (typeof BRANDING_ASSET_KINDS)[number];

export class UpsertBrandingDraftDto {
  @IsObject()
  config: Record<string, unknown>;
}

export class RollbackBrandingDto {
  @IsInt()
  @Min(1)
  version: number;
}

export class UploadBrandingAssetDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(BRANDING_ASSET_KINDS)
  assetKind: BrandingAssetKind;

  @IsOptional()
  @IsString()
  @Max(2048)
  @IsUrl({ require_tld: false }, { message: 'assetUrl must be a valid URL' })
  assetUrl?: string;
}
