import {
  BaseRepository,
} from "./base-repository";

import type {
  OAuthInstallation,
  OAuthAccountType,
} from "../models/oauth-installation";


export class OAuthInstallationRepository
  extends BaseRepository {


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
        result.access_token as string,

      refreshToken:
        result.refresh_token as
          string | null,

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

        installation.externalUserId,

        installation.accessToken,

        installation.refreshToken,

        installation.accessTokenExpiresAt ??
          null,

        installation.metadata,
      )
      .run();
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
          accessToken,
          refreshToken,
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