import type { IntegrationConfiguration } from "../../../persistence/models/integration-configuration";
import type { AttributeMapping } from "../../../persistence/models/integration-configuration/attribute-mapping";
import type { State } from "../../../persistence/models/integration-configuration/state";
import type { Workflow } from "../../../persistence/models/integration-configuration/workflow";

import type { GHLMetadata } from "./metadata";

import { logger } from "../../../core/logger";
import { GHL_CANONICAL_FIELD_MAP } from "../../../domain/integration/canonical-field-map";

export function discoverConfiguration(
  metadata: GHLMetadata,
): IntegrationConfiguration {

  logger.info("Building GoHighLevel integration configuration", {
    pipelines: metadata.pipelines.length,
    stages: metadata.stages.length,
    customFields: metadata.customFields.length,
  });

  if (metadata.pipelines.length === 0) {
    throw new Error("No pipelines found.");
  }

  // Temporary: use the Reservation pipeline if available.
  const primaryPipeline =
    metadata.pipelines.find(
      (pipeline) =>
        normalizeKey(pipeline.name) === "reservation",
    ) ??
    metadata.pipelines[0];

  logger.debug("Selected pipeline", {
    id: primaryPipeline.id,
    name: primaryPipeline.name,
  });

  const states: State[] = metadata.stages
    .filter((stage) => stage.pipelineId === primaryPipeline.id)
    .map((stage) => ({
      key: normalizeKey(stage.name),
      providerStateId: stage.id,
    }));

  logger.debug("Workflow states discovered", {
    workflow: primaryPipeline.name,
    count: states.length,
  });

  const workflow: Workflow = {
    key: normalizeKey(primaryPipeline.name),
    providerWorkflowId: primaryPipeline.id,
    states,
  };

  const attributeMappings = metadata.customFields.flatMap(
    (field): AttributeMapping[] => {

      const canonicalKey =
        GHL_CANONICAL_FIELD_MAP[field.name] ??
        GHL_CANONICAL_FIELD_MAP[field.key ?? ""];

      if (!canonicalKey) {
        logger.debug("Skipping unmapped custom field", {
          id: field.id,
          name: field.name,
          key: field.key,
        });

        return [];
      }

      logger.debug("Mapped custom field", {
        canonicalKey,
        providerFieldId: field.id,
        providerFieldKey: field.key,
      });

      return [
        {
          canonicalKey,
          providerFieldId: field.id,
          providerFieldKey: field.key,
        },
      ];
    },
  );

  logger.info("GoHighLevel configuration discovered", {
    workflow: workflow.key,
    workflowId: workflow.providerWorkflowId,
    states: workflow.states.length,
    attributeMappings: attributeMappings.length,
  });

  return {
    workflow,
    attributeMappings,
  };
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}