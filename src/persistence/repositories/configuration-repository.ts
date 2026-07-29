import { BaseRepository } from "./base-repository";
import type { IntegrationConfiguration } from "../models/integration-configuration";

export class ConfigurationRepository extends BaseRepository {

  async getByIntegrationId(
    integrationId: string,
  ): Promise<IntegrationConfiguration | null> {

    const result = await this.db
      .prepare(
        `
        SELECT settings
        FROM integrations
        WHERE id = ?
        LIMIT 1
        `,
      )
      .bind(integrationId)
      .first<{ settings: string | null }>();

    if (!result?.settings) {
      return null;
    }

    return JSON.parse(result.settings) as IntegrationConfiguration;
  }

  async save(
    integrationId: string,
    configuration: IntegrationConfiguration,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE integrations
        SET settings = ?
        WHERE id = ?
        `,
      )
      .bind(
        JSON.stringify(configuration),
        integrationId,
      )
      .run();
  }
}