import { logger } from "../../core/logger";

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

    logger.debug("Loading integration configuration", {
      integrationId,
      hasConfiguration: !!result?.settings,
    });

    if (!result?.settings) {
      return null;
    }

    const configuration = JSON.parse(
      result.settings,
    ) as IntegrationConfiguration;

    logger.debug("Integration configuration loaded", {
      integrationId,
      workflow: configuration.workflow.key,
      attributeMappings:
        configuration.attributeMappings.length,
    });

    return configuration;
  }

  async save(
    integrationId: string,
    configuration: IntegrationConfiguration,
  ): Promise<void> {

    logger.info("Persisting integration configuration", {
      integrationId,
    });

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

    logger.info("Integration configuration persisted", {
      integrationId,
    });
  }
}