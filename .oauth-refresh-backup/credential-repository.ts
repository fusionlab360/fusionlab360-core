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

        apiKey:
          row.api_key as string,

        locationId:
          row.location_id as string,

        refreshToken:
          row.refresh_token as
            string | null,

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

      apiKey:
        result.api_key as string,

      locationId:
        result.location_id as string,

      refreshToken:
        result.refresh_token as
          string | null,

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
   * Store or replace a provider OAuth credential.
   *
   * The existing api_key column is used as the
   * provider access-token field by the current
   * integration architecture.
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
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO integration_credentials (
          tenant_id,
          provider,
          api_key,
          location_id,
          refresh_token,
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
            excluded.refresh_token,

          metadata =
            excluded.metadata,

          updated_at =
            CURRENT_TIMESTAMP
        `,
      )
      .bind(
        tenantId,
        provider,
        accessToken,
        locationId,
        refreshToken,
        metadata,
      )
      .run();
  }
}