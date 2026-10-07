import type { IntegrationConfiguration } from "../../../persistence/models/integration-configuration";
import type { AttributeMapping } from "../../../persistence/models/integration-configuration/attribute-mapping";
import type { State } from "../../../persistence/models/integration-configuration/state";
import type { Workflow } from "../../../persistence/models/integration-configuration/workflow";

import type { GHLMetadata } from "./metadata";

import { logger } from "../../../core/logger";
import { GHL_CANONICAL_FIELD_MAP } from "../../../domain/integration/canonical-field-map";

export function discoverConfiguration(
  metadata: GHLMetadata,
  pipelineId: string,
): IntegrationConfiguration {

  logger.info("Building GoHighLevel integration configuration", {
    pipelines: metadata.pipelines.length,
    stages: metadata.stages.length,
    customFields: metadata.customFields.length,
  });

  if (metadata.pipelines.length === 0) {
    throw new Error("No pipelines found.");
  }

  const primaryPipeline = metadata.pipelines.find(
  (pipeline) => pipeline.id === pipelineId,
);

if (!primaryPipeline) {
  throw new Error(
    `Pipeline '${pipelineId}' not found.`,
  );
}

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

      logger.info("DISCOVERED CUSTOM FIELD", {
      model: field.model,
      name: field.name,
      key: field.key,
});

      const canonicalKey =
        GHL_CANONICAL_FIELD_MAP[field.name] ??
        GHL_CANONICAL_FIELD_MAP[field.key ?? ""];

        console.log(
  "GHL FIELD MAP DEBUG:",
  JSON.stringify(
    {
      model: field.model,
      name: field.name,
      key: field.key,
      id: field.id,
      canonicalKey,
    },
    null,
    2,
  ),
);

        logger.info("FIELD MAPPING RESULT", {
  model: field.model,
  name: field.name,
  canonicalKey,
});

      if (!canonicalKey) {
        logger.info("CUSTOM FIELD DISCOVERED", {
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

  console.log(
  "GHL FINAL ATTRIBUTE MAPPINGS:",
  JSON.stringify(
    attributeMappings,
    null,
    2,
  ),
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