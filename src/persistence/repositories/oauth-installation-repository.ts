import {
  BaseRepository,
} from "./base-repository";

import type {
  OAuthInstallation,
  OAuthAccountType,
} from "../models/oauth-installation";
import {
  CredentialCipherError,
} from "../../core/security/encrypted-credential";
import type {
  CredentialStorageConfiguration,
} from "../../core/security/credential-storage";
import {
  decryptCredentialValue,
  encryptCredentialValue,
  isEncryptedCredential,
  oauthInstallationCredentialContext,
} from "../../core/security/credential-storage";


export class OAuthInstallationRepository
  extends BaseRepository {

  constructor(
    db: D1Database,
    private readonly credentialStorage: CredentialStorageConfiguration = {
      allowLegacyPlaintextReads: false,
    },
  ) {
    super(db);
  }

  private async protectToken(
    provider: string,
    accountType: OAuthAccountType,
    externalAccountId: string,
    field: "access" | "refresh",
    value: string | null | undefined,
  ): Promise<string | null> {
    if (provider !== "gohighlevel") return value ?? null;
    const cipher = this.credentialStorage.cipher;
    if (!cipher) {
      throw new CredentialCipherError("Credential encryption must be configured before GHL credentials can be written.");
    }
    return encryptCredentialValue(
      cipher,
      oauthInstallationCredentialContext(provider, accountType, externalAccountId, field),
      value,
    );
  }

  private async resolveToken(
    provider: string,
    accountType: OAuthAccountType,
    externalAccountId: string,
    field: "access" | "refresh",
    value: string | null | undefined,
  ): Promise<string | null> {
    if (provider !== "gohighlevel") return value ?? null;
    return decryptCredentialValue(
      this.credentialStorage.cipher,
      oauthInstallationCredentialContext(provider, accountType, externalAccountId, field),
      value,
      this.credentialStorage.allowLegacyPlaintextReads,
    );
  }


  async find(
    provider: string,
    accountType: OAuthAccountType,
    externalAccountId: string,
  ): Promise<
    OAuthInstallation | null
  > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM oauth_installations
          WHERE provider = ?
            AND account_type = ?
            AND external_account_id = ?
          LIMIT 1
          `,
        )
        .bind(
          provider,
          accountType,
          externalAccountId,
        )
        .first();


    if (!result) {
      return null;
    }

    const accessToken = await this.resolveToken(
      provider,
      accountType,
      externalAccountId,
      "access",
      result.access_token as string,
    );
    const refreshToken = await this.resolveToken(
      provider,
      accountType,
      externalAccountId,
      "refresh",
      result.refresh_token as string | null,
    );


    return {
      provider:
        result.provider as string,

      accountType:
        result.account_type as OAuthAccountType,

      externalAccountId:
        result.external_account_id as string,

      externalUserId:
        result.external_user_id as
          string | null,

      accessToken:
        accessToken ?? "",

      refreshToken:
        refreshToken,

      accessTokenExpiresAt:
        result.access_token_expires_at as
          number | null,

      refreshLockToken:
        result.refresh_lock_token as
          string | null,

      refreshLockExpiresAt:
        result.refresh_lock_expires_at as
          number | null,

      metadata:
        result.metadata as
          string | null,

      createdAt:
        result.created_at as string,

      updatedAt:
        result.updated_at as string,
    };
  }


  async upsert(
    installation:
      OAuthInstallation,
  ): Promise<void> {

    const incomingRefreshToken =
      typeof installation.refreshToken === "string" && installation.refreshToken.trim()
        ? installation.refreshToken.trim()
        : null;
    const accessToken = await this.protectToken(
      installation.provider,
      installation.accountType,
      installation.externalAccountId,
      "access",
      installation.accessToken,
    );
    const refreshToken = await this.protectToken(
      installation.provider,
      installation.accountType,
      installation.externalAccountId,
      "refresh",
      incomingRefreshToken,
    );

    await this.db
      .prepare(
        `
        INSERT INTO oauth_installations (
          provider,
          account_type,
          external_account_id,
          external_user_id,
          access_token,
          refresh_token,
          access_token_expires_at,
          refresh_lock_token,
          refresh_lock_expires_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          NULL,
          NULL,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (
          provider,
          account_type,
          external_account_id
        )
        DO UPDATE SET

          external_user_id =
            excluded.external_user_id,

          access_token =
            excluded.access_token,

          refresh_token =
            COALESCE(
              excluded.refresh_token,
              oauth_installations.refresh_token
            ),

          access_token_expires_at =
            excluded.access_token_expires_at,

          metadata =
            excluded.metadata,

          updated_at =
            CURRENT_TIMESTAMP
        `,
      )
      .bind(
        installation.provider,

        installation.accountType,

        installation.externalAccountId,

        installation.externalUserId ?? null,

        accessToken,

        refreshToken,

        installation.accessTokenExpiresAt ??
          null,

        installation.metadata,
      )
      .run();
  }

  /** Insert a shared provider installation without replacing another tenant's token. */
  async createIfAbsent(
    installation: OAuthInstallation,
  ): Promise<boolean> {
    const accessToken = await this.protectToken(
      installation.provider,
      installation.accountType,
      installation.externalAccountId,
      "access",
      installation.accessToken,
    );
    const refreshToken = await this.protectToken(
      installation.provider,
      installation.accountType,
      installation.externalAccountId,
      "refresh",
      installation.refreshToken,
    );
    const result = await this.db
      .prepare(
        `
        INSERT INTO oauth_installations (
          provider,
          account_type,
          external_account_id,
          external_user_id,
          access_token,
          refresh_token,
          access_token_expires_at,
          refresh_lock_token,
          refresh_lock_expires_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (provider, account_type, external_account_id)
        DO NOTHING
        `,
      )
      .bind(
        installation.provider,
        installation.accountType,
        installation.externalAccountId,
        installation.externalUserId ?? null,
        accessToken,
        refreshToken,
        installation.accessTokenExpiresAt ?? null,
        installation.metadata,
      )
      .run();

    return (result.meta?.changes ?? 0) === 1;
  }


  /**
   * Atomically acquire the OAuth refresh lease.
   *
   * The lease is acquired when:
   *
   *   refresh_lock_token IS NULL
   *
   * OR
   *
   *   refresh_lock_expires_at IS NULL
   *
   * OR
   *
   *   refresh_lock_expires_at <= now
   *
   * This prevents concurrent Workers from using the
   * same rotating OAuth refresh token simultaneously.
   */
  async acquireRefreshLock(
    provider: string,
    accountType: OAuthAccountType,
    externalAccountId: string,
    lockToken: string,
    now: number,
    lockExpiresAt: number,
  ): Promise<boolean> {

    const result =
      await this.db
        .prepare(
          `
          UPDATE oauth_installations

          SET
            refresh_lock_token = ?,
            refresh_lock_expires_at = ?,
            updated_at = CURRENT_TIMESTAMP

          WHERE
            provider = ?

            AND account_type = ?

            AND external_account_id = ?

            AND (
              refresh_lock_token IS NULL

              OR refresh_lock_expires_at IS NULL

              OR refresh_lock_expires_at <= ?
            )
          `,
        )
        .bind(
          lockToken,
          lockExpiresAt,
          provider,
          accountType,
          externalAccountId,
          now,
        )
        .run();


    return (
      (result.meta?.changes ?? 0) >
      0
    );
  }


  /**
   * Release a refresh lease.
   *
   * The lock token must match the token that acquired
   * the lease. This prevents one Worker from releasing
   * another Worker's lock.
   */
  async releaseRefreshLock(
    provider: string,
    accountType: OAuthAccountType,
    externalAccountId: string,
    lockToken: string,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE oauth_installations

        SET
          refresh_lock_token = NULL,
          refresh_lock_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP

        WHERE
          provider = ?

          AND account_type = ?

          AND external_account_id = ?

          AND refresh_lock_token = ?
        `,
      )
      .bind(
        provider,
        accountType,
        externalAccountId,
        lockToken,
      )
      .run();
  }


  /**
   * Save a refreshed OAuth token pair.
   *
   * The refresh lock must belong to the caller.
   *
   * This method also clears the lock after the new
   * access/refresh token pair has been persisted.
   */
  async saveRefreshedToken(
    provider: string,
    accountType: OAuthAccountType,
    externalAccountId: string,
    lockToken: string,
    accessToken: string,
    refreshToken: string | null,
    accessTokenExpiresAt:
      number | null,
    metadata: string | null,
  ): Promise<boolean> {

    const incomingRefreshToken =
      typeof refreshToken === "string" && refreshToken.trim()
        ? refreshToken.trim()
        : null;
    const existing = provider === "gohighlevel"
      ? await this.find(provider, accountType, externalAccountId)
      : null;
    if (provider === "gohighlevel" && (!existing || !existing.refreshLockToken || existing.refreshLockToken !== lockToken)) {
      return false;
    }
    const accessTokenToPersist = await this.protectToken(
      provider,
      accountType,
      externalAccountId,
      "access",
      accessToken,
    );
    const refreshTokenToPersist = await this.protectToken(
      provider,
      accountType,
      externalAccountId,
      "refresh",
      incomingRefreshToken ?? existing?.refreshToken ?? null,
    );

    const result =
      await this.db
        .prepare(
          `
          UPDATE oauth_installations

          SET
            access_token = ?,

            refresh_token =
              COALESCE(
                ?,
                refresh_token
              ),

            access_token_expires_at = ?,

            metadata = ?,

            refresh_lock_token = NULL,

            refresh_lock_expires_at = NULL,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            provider = ?

            AND account_type = ?

            AND external_account_id = ?

            AND refresh_lock_token = ?
          `,
        )
        .bind(
          accessTokenToPersist,
          refreshTokenToPersist,
          accessTokenExpiresAt,
          metadata,
          provider,
          accountType,
          externalAccountId,
          lockToken,
        )
        .run();


    return (
      (result.meta?.changes ?? 0) >
      0
    );
  }

  /** Encrypt one bounded batch of legacy GHL company/location installations. */
  async migratePlaintextBatch(limit = 50, accountType?: OAuthAccountType): Promise<number> {
    const cipher = this.credentialStorage.cipher;
    if (!cipher) {
      throw new CredentialCipherError("Credential encryption must be configured before migration.");
    }
    const batchSize = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : 50;
    const rows = await this.db.prepare(`
      SELECT provider, account_type, external_account_id, access_token, refresh_token
      FROM oauth_installations
      WHERE provider = 'gohighlevel'
        AND (? IS NULL OR account_type = ?)
        AND ((access_token IS NOT NULL AND access_token <> '' AND access_token NOT LIKE 'fl360enc:%')
          OR (refresh_token IS NOT NULL AND refresh_token <> '' AND refresh_token NOT LIKE 'fl360enc:%'))
      ORDER BY account_type, external_account_id
      LIMIT ?
    `).bind(accountType ?? null, accountType ?? null, batchSize).all<{
      provider: string;
      account_type: OAuthAccountType;
      external_account_id: string;
      access_token: string;
      refresh_token: string | null;
    }>();

    let migrated = 0;
    for (const row of rows.results ?? []) {
      const context = (field: "access" | "refresh") =>
        oauthInstallationCredentialContext(row.provider, row.account_type, row.external_account_id, field);
      const access = row.access_token && !isEncryptedCredential(row.access_token)
        ? await encryptCredentialValue(cipher, context("access"), row.access_token)
        : row.access_token;
      const refresh = row.refresh_token && !isEncryptedCredential(row.refresh_token)
        ? await encryptCredentialValue(cipher, context("refresh"), row.refresh_token)
        : row.refresh_token;
      const result = await this.db.prepare(`
        UPDATE oauth_installations SET access_token = ?, refresh_token = ?, updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'gohighlevel' AND account_type = ? AND external_account_id = ?
          AND access_token IS ? AND refresh_token IS ?
      `).bind(access, refresh, row.account_type, row.external_account_id, row.access_token, row.refresh_token).run();
      migrated += result.meta?.changes ?? 0;
    }
    return migrated;
  }


  async delete(
    provider: string,
    accountType: OAuthAccountType,
    externalAccountId: string,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        DELETE FROM oauth_installations
        WHERE provider = ?
          AND account_type = ?
          AND external_account_id = ?
        `,
      )
      .bind(
        provider,
        accountType,
        externalAccountId,
      )
      .run();
  }
}
