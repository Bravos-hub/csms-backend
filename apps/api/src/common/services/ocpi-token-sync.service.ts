import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

type SyncUserTokenInput = {
  id: string | null;
  idTag: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  status: string | null;
};

@Injectable()
export class OcpiTokenSyncService {
  private readonly logger = new Logger(OcpiTokenSyncService.name);
  private readonly defaultCountryCode: string;
  private readonly defaultPartyId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.defaultCountryCode = (
      this.config.get<string>('OCPI_COUNTRY_CODE') || 'US'
    )
      .trim()
      .toUpperCase();
    this.defaultPartyId = (this.config.get<string>('OCPI_PARTY_ID') || 'EVZ')
      .trim()
      .toUpperCase();
  }

  /**
   * Syncs a user's token with the OCPI system.
   * @param user The user entity to sync
   */
  async syncUserToken(user: unknown): Promise<void> {
    const normalizedUser = this.normalizeUser(user);
    if (!normalizedUser) {
      return;
    }

    try {
      const tokenUid = this.resolveUserTokenUid(normalizedUser);
      if (!tokenUid) {
        return;
      }
      await this.upsertToken(tokenUid, {
        uid: tokenUid,
        type: 'APP_USER',
        contract_id: String(normalizedUser.id || tokenUid),
        visual_number: String(normalizedUser.phone || ''),
        issuer: 'EVzone',
        valid:
          String(normalizedUser.status || '').toUpperCase() !== 'SUSPENDED',
        whitelist: 'ALLOWED',
        language: 'en',
        user: {
          id: normalizedUser.id,
          email: normalizedUser.email,
          phone: normalizedUser.phone,
          name: normalizedUser.name,
        },
        last_updated: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.stack || error.message : String(error);
      this.logger.error(
        `Failed to sync OCPI token for user ${
          normalizedUser.id ||
          normalizedUser.email ||
          normalizedUser.phone ||
          'unknown'
        }`,
        errorMessage,
      );
      // We do not throw here to prevent blocking main auth flows
    }
  }

  /**
   * Syncs an ID Tag token with the OCPI system.
   * @param idTag The ID Tag to sync
   */
  async syncIdTagToken(idTag: string | null): Promise<void> {
    try {
      if (!idTag) return;
      const normalized = idTag.trim();
      if (!normalized) return;
      await this.upsertToken(normalized, {
        uid: normalized,
        type: 'RFID',
        contract_id: normalized,
        issuer: 'EVzone',
        valid: true,
        whitelist: 'ALLOWED',
        language: 'en',
        last_updated: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.stack || error.message : String(error);
      this.logger.error(
        `Failed to sync OCPI token for idTag ${idTag}`,
        errorMessage,
      );
    }
  }

  private resolveUserTokenUid(user: SyncUserTokenInput): string | null {
    if (typeof user.idTag === 'string' && user.idTag.trim().length > 0) {
      return user.idTag.trim();
    }

    if (typeof user.phone === 'string' && user.phone.trim().length > 0) {
      return user.phone.trim();
    }

    if (typeof user.email === 'string' && user.email.trim().length > 0) {
      return user.email.trim().toLowerCase();
    }

    if (typeof user.id === 'string' && user.id.trim().length > 0) {
      return user.id.trim();
    }

    return null;
  }

  private normalizeUser(user: unknown): SyncUserTokenInput | null {
    if (!user || typeof user !== 'object') {
      return null;
    }

    const source = user as Record<string, unknown>;
    return {
      id: this.readOptionalString(source, 'id'),
      idTag: this.readOptionalString(source, 'idTag'),
      email: this.readOptionalString(source, 'email'),
      phone: this.readOptionalString(source, 'phone'),
      name: this.readOptionalString(source, 'name'),
      status: this.readOptionalString(source, 'status'),
    };
  }

  private readOptionalString(
    source: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = source[key];
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async upsertToken(
    tokenUid: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const tokenType =
      typeof data.type === 'string' && data.type.trim().length > 0
        ? data.type.trim().toUpperCase()
        : 'RFID';
    const lastUpdatedRaw = data.last_updated;
    const lastUpdated =
      typeof lastUpdatedRaw === 'string'
        ? new Date(lastUpdatedRaw)
        : new Date();

    const existing = await this.prisma.ocpiToken.findUnique({
      where: {
        countryCode_partyId_tokenUid_tokenType: {
          countryCode: this.defaultCountryCode,
          partyId: this.defaultPartyId,
          tokenUid,
          tokenType,
        },
      },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.ocpiToken.update({
        where: { id: existing.id },
        data: {
          data: data as Prisma.InputJsonValue,
          valid: Boolean(data.valid ?? true),
          lastUpdated,
        },
      });
      return;
    }

    await this.prisma.ocpiToken.create({
      data: {
        countryCode: this.defaultCountryCode,
        partyId: this.defaultPartyId,
        tokenUid,
        tokenType,
        data: data as Prisma.InputJsonValue,
        valid: Boolean(data.valid ?? true),
        lastUpdated,
      },
    });
  }
}
