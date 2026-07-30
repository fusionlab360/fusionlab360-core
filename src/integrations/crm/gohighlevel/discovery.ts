import type { IntegrationConfiguration } from "../../../persistence/models/integration-configuration";
import type { AttributeMapping } from "../../../persistence/models/integration-configuration/attribute-mapping";
import type { State } from "../../../persistence/models/integration-configuration/state";
import type { Workflow } from "../../../persistence/models/integration-configuration/workflow";

import type { GHLMetadata } from "./metadata";

import { GHL_CANONICAL_FIELD_MAP } from "../../../domain/integration/canonical-field-map";

export function discoverConfiguration(
  metadata: GHLMetadata,
): IntegrationConfiguration {
  if (metadata.pipelines.length === 0) {
    throw new Error("No pipelines found.");
  }

  // Temporary: use the Reservation pipeline if available.
  // Later this will become user-selectable.
  const primaryPipeline =
    metadata.pipelines.find(
      (pipeline) =>
        normalizeKey(pipeline.name) === "reservation",
    ) ??
    metadata.pipelines[0];

  const states: State[] = metadata.stages
    .filter((stage) => stage.pipelineId === primaryPipeline.id)
    .map((stage) => ({
      key: normalizeKey(stage.name),
      providerStateId: stage.id,
    }));

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
        return [];
      }

      return [
        {
          canonicalKey,
          providerFieldId: field.id,
          providerFieldKey: field.key,
        },
      ];
    },
  );

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