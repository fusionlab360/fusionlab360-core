import {
  BaseRepository,
} from "./base-repository";

import type {
  OAuthInstallation,
} from "../models/oauth-installation";


export class OAuthInstallationRepository
  extends BaseRepository {


  async find(
    provider: string,
    accountType: string,
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
        result.account_type as string,

      externalAccountId:
        result.external_account_id as string,

      externalUserId:
        result.external_user_id as string | null,

      accessToken:
        result.access_token as string,

      refreshToken:
        result.refresh_token as string | null,

      metadata:
        result.metadata as string | null,

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
            excluded.refresh_token,

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
        installation.metadata,
      )
      .run();
  }


  async delete(
    provider: string,
    accountType: string,
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