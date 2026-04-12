export const WHITE_LABEL_SCHEMA_VERSION = 1 as const;

export const BRANDING_FONT_OPTIONS = [
  'Inter',
  'Roboto',
  'Outfit',
  'Plus Jakarta Sans',
] as const;

export type WhiteLabelFontFamily = (typeof BRANDING_FONT_OPTIONS)[number];

export interface WhiteLabelConfigV1 {
  schemaVersion: typeof WHITE_LABEL_SCHEMA_VERSION;
  branding: {
    appName: string;
    shortName: string;
    logoUrl: string | null;
    logoIconUrl: string | null;
    faviconUrl: string | null;
  };
  theme: {
    primaryColor: string;
    accentColor: string | null;
    borderRadiusPx: number;
    fontFamily: WhiteLabelFontFamily;
  };
  legal: {
    termsUrl: string | null;
    privacyUrl: string | null;
    supportUrl: string | null;
  };
  support: {
    email: string | null;
    phone: string | null;
  };
  domain: {
    primaryDomain: string | null;
    allowedOrigins: string[];
  };
  metadata: {
    lastEditedBy: string | null;
    lastEditedAt: string | null;
  };
}

export type BrandingRevisionSummary = {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ROLLED_BACK';
  publishedAt: string | null;
  rolledBackFromVersion: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
