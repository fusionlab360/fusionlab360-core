import {
  BaseRepository,
} from "./base-repository";

import type {
  IntegrationCredential,
} from "../models/integration-credential";


export class CredentialRepository
  extends BaseRepository {


  async findByTenant(
    tenantId: string,
  ): Promise<
    IntegrationCredential[]
  > {

    const {
      results,
    } =
      await this.db
        .prepare(
          `
          SELECT *
          FROM integration_credentials
          WHERE tenant_id = ?
          `,
        )
        .bind(
          tenantId,
        )
        .all();


    return (
      results ?? []
    ).map(
      (row) => ({
        tenantId:
          row.tenant_id as string,

        provider:
          row.provider as string,

        authType:
          row.auth_type as
            IntegrationCredential["authType"],

        apiKey:
          typeof row.api_key === "string"
            ? row.api_key
            : "",

        locationId:
          row.location_id as string,

        refreshToken:
          row.refresh_token as
            string | null,

        accessTokenExpiresAt:
          row.access_token_expires_at as
            number | null,

        refreshLockToken:
          row.refresh_lock_token as
            string | null,

        refreshLockExpiresAt:
          row.refresh_lock_expires_at as
            number | null,

        metadata:
          row.metadata as
            string | null,

        createdAt:
          row.created_at as string,

        updatedAt:
          row.updated_at as string,
      }),
    );
  }


  async findByTenantAndProvider(
    tenantId: string,
    provider: string,
  ): Promise<
    IntegrationCredential | null
  > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM integration_credentials
          WHERE tenant_id = ?
            AND provider = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          provider,
        )
        .first();


    if (!result) {
      return null;
    }


    return {
      tenantId:
        result.tenant_id as string,

      provider:
        result.provider as string,

      authType:
        result.auth_type as
          IntegrationCredential["authType"],

      apiKey:
        typeof result.api_key === "string"
          ? result.api_key
          : "",

      locationId:
        result.location_id as string,

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


  async findTenantIdByProviderAndLocation(
    provider: string,
    locationId: string,
  ): Promise<
    string | null
  > {

    const result =
      await this.db
        .prepare(
          `
          SELECT
            tenant_id
          FROM integration_credentials
          WHERE provider = ?
            AND location_id = ?
          LIMIT 1
          `,
        )
        .bind(
          provider,
          locationId,
        )
        .first<{
          tenant_id: string;
        }>();


    return (
      result?.tenant_id ??
      null
    );
  }


  /**
   * Find all already-connected locations
   * for a provider/company combination.
   *
   * This is used when HighLevel sends an
   * agency/company-level OAuth UPDATE event
   * without a locationId.
   */
  async findLocationsByProviderAndCompany(
    provider: string,
    companyId: string,
  ): Promise<
    Array<{
      tenantId: string;
      locationId: string;
    }>
  > {

    const {
      results,
    } =
      await this.db
        .prepare(
          `
          SELECT
            tenant_id,
            location_id,
            metadata
          FROM integration_credentials
          WHERE provider = ?
          `,
        )
        .bind(
          provider,
        )
        .all();


    return (
      results ?? []
    )
      .map(
        (row) => {

          let metadata:
            | Record<
                string,
                unknown
              >
            | null = null;


          try {

            metadata =
              typeof row.metadata ===
              "string"
                ? JSON.parse(
                    row.metadata,
                  )
                : null;

          } catch {

            metadata = null;

          }


          return {
            tenantId:
              row.tenant_id as string,

            locationId:
              row.location_id as string,

            companyId:
              typeof metadata
                ?.companyId ===
              "string"
                ? metadata.companyId
                : null,
          };
        },
      )
      .filter(
        (row) =>
          row.companyId ===
          companyId,
      )
      .map(
        ({
          tenantId,
          locationId,
        }) => ({
          tenantId,
          locationId,
        }),
      );
  }


  /**
   * Store or update a provider OAuth credential.
   *
   * IMPORTANT:
   *
   * This method will NEVER overwrite an existing
   * api_key credential.
   *
   * Existing credential:
   *
   *   auth_type = api_key
   *
   * remains untouched.
   *
   * Existing credential:
   *
   *   auth_type = oauth2
   *
   * may be updated.
   *
   * New credential:
   *
   *   auth_type = oauth2
   */
  async upsertOAuthCredential(
    tenantId: string,
    provider: string,
    locationId: string,
    accessToken: string,
    refreshToken:
      string | null,
    metadata:
      string | null,
    accessTokenExpiresAt:
      number | null = null,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO integration_credentials (
          tenant_id,
          provider,
          auth_type,
          api_key,
          location_id,
          refresh_token,
          access_token_expires_at,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          'oauth2',
          ?,
          ?,
          ?,
          ?,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT (
          tenant_id,
          provider
        )
        DO UPDATE SET

          api_key =
            excluded.api_key,

          location_id =
            excluded.location_id,

          refresh_token =
            COALESCE(
              excluded.refresh_token,
              integration_credentials.refresh_token
            ),

          access_token_expires_at =
            excluded.access_token_expires_at,

          metadata =
            excluded.metadata,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          integration_credentials.auth_type =
            'oauth2'
        `,
      )
      .bind(
        tenantId,
        provider,
        accessToken,
        locationId,
        refreshToken,
        accessTokenExpiresAt,
        metadata,
      )
      .run();
  }

    /**
   * Atomically acquire the OAuth refresh lease for a
   * tenant/provider credential.
   */
  async acquireOAuthRefreshLock(
    tenantId: string,
    provider: string,
    lockToken: string,
    now: number,
    lockExpiresAt: number,
  ): Promise<boolean> {

    const result =
      await this.db
        .prepare(
          `
          UPDATE integration_credentials

          SET
            refresh_lock_token = ?,
            refresh_lock_expires_at = ?,
            updated_at = CURRENT_TIMESTAMP

          WHERE
            tenant_id = ?

            AND provider = ?

            AND auth_type = 'oauth2'

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
          tenantId,
          provider,
          now,
        )
        .run();


    return (
      (result.meta?.changes ?? 0) >
      0
    );
  }


  /**
   * Release the OAuth refresh lease.
   *
   * Only the Worker holding the matching lock token
   * can release it.
   */
  async releaseOAuthRefreshLock(
    tenantId: string,
    provider: string,
    lockToken: string,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE integration_credentials

        SET
          refresh_lock_token = NULL,
          refresh_lock_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP

        WHERE
          tenant_id = ?

          AND provider = ?

          AND refresh_lock_token = ?
        `,
      )
      .bind(
        tenantId,
        provider,
        lockToken,
      )
      .run();
  }

    /**
   * Update OAuth lifecycle metadata without changing
   * the access token or refresh token.
   *
   * Used by the automatic OAuth recovery path to record
   * recovery failures/backoff state.
   */
  async updateOAuthMetadata(
    tenantId: string,
    provider: string,
    metadata: string | null,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE integration_credentials

        SET
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP

        WHERE
          tenant_id = ?

          AND provider = ?

          AND auth_type = 'oauth2'
        `,
      )
      .bind(
        metadata,
        tenantId,
        provider,
      )
      .run();
  }

  /**
   * Save a freshly rotated OAuth token pair.
   *
   * The update is permitted only when the caller still
   * owns the refresh lease.
   */
  async saveRefreshedOAuthCredential(
    tenantId: string,
    provider: string,
    lockToken: string,
    accessToken: string,
    refreshToken: string | null,
    accessTokenExpiresAt: number | null,
    metadata: string | null,
  ): Promise<boolean> {

    if (!accessToken?.trim()) {
      throw new Error(
        "Cannot persist an empty GHL OAuth access token.",
      );
    }

    if (!tenantId?.trim()) {
      throw new Error(
        "tenantId is required.",
      );
    }

    if (!provider?.trim()) {
      throw new Error(
        "provider is required.",
      );
    }

    if (!lockToken?.trim()) {
      throw new Error(
        "OAuth refresh lock token is required.",
      );
    }

    const normalizedAccessToken =
      accessToken.trim();

    const normalizedRefreshToken =
      typeof refreshToken === "string" &&
      refreshToken.trim()
        ? refreshToken.trim()
        : null;

    const result =
      await this.db
        .prepare(
          `
          UPDATE integration_credentials

          SET
            api_key = ?,

            refresh_token =
              COALESCE(
                ?,
                refresh_token
              ),

            access_token_expires_at = ?,

            metadata = ?,

            refresh_lock_token = NULL,

            refresh_lock_expires_at = NULL,

            updated_at = CURRENT_TIMESTAMP

          WHERE
            tenant_id = ?

            AND provider = ?

            AND auth_type = 'oauth2'

            AND refresh_lock_token = ?
          `,
        )

        
        .bind(
            normalizedAccessToken,
            normalizedRefreshToken,
            accessTokenExpiresAt,
            metadata,
            tenantId.trim(),
            provider.trim(),
            lockToken.trim(),
          )
        .run();


    return (
      (result.meta?.changes ?? 0) >
      0
    );
  }

}