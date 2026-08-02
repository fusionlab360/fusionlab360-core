import { logger } from "../../../core/logger";

import { getPipelines } from "./opportunities/pipelines";
import { getCustomFields } from "./customfields";

export interface GHLPipelineMetadata {
  id: string;
  name: string;
}

export interface GHLStageMetadata {
  id: string;
  name: string;
  pipelineId: string;
}

export interface GHLFieldMetadata {
  id: string;
  key?: string;
  name: string;
  model: "contact" | "opportunity";
}

export interface GHLMetadata {
  pipelines: GHLPipelineMetadata[];
  stages: GHLStageMetadata[];
  customFields: GHLFieldMetadata[];
}

export async function resolveMetadata(
  apiKey: string,
  locationId: string,
): Promise<GHLMetadata> {
  logger.info("Resolving GoHighLevel metadata", {
    locationId,
  });

  logger.debug("Loading pipelines");

  const pipelineResponse = await getPipelines(
    apiKey,
    locationId,
  );

  if (
    !pipelineResponse ||
    !Array.isArray((pipelineResponse as any).pipelines)
  ) {
    throw new Error(
      `Invalid pipeline response:\n${JSON.stringify(
        pipelineResponse,
        null,
        2,
      )}`,
    );
  }

  const pipelines = (pipelineResponse as any).pipelines;

  const pipelineMetadata: GHLPipelineMetadata[] =
    pipelines.map((pipeline: any) => ({
      id: pipeline.id,
      name: pipeline.name,
    }));

  logger.debug("Pipelines loaded", {
    count: pipelineMetadata.length,
  });

  const stageMetadata: GHLStageMetadata[] = [];

  for (const pipeline of pipelines) {
    const stages = pipeline.stages ?? [];

    stageMetadata.push(
      ...stages.map((stage: any) => ({
        id: stage.id,
        name: stage.name,
        pipelineId: pipeline.id,
      })),
    );
  }

  logger.debug("Stages loaded", {
    count: stageMetadata.length,
  });

  const fieldMetadata: GHLFieldMetadata[] = [];

  try {
    logger.debug("Loading contact custom fields");

    const contactFields = await getCustomFields(
  apiKey,
  locationId,
  "contact",
);

logger.info("Contact custom fields fetched", {
  count: contactFields.customFields.length,
});

    if (Array.isArray(contactFields.customFields)) {
      fieldMetadata.push(
        ...contactFields.customFields.map((field: any) => ({
          id: field.id,
          key: field.fieldKey,
          name: field.name,
          model: "contact" as const,
        })),
      );
    }

    logger.debug("Loading opportunity custom fields");

    const opportunityFields = await getCustomFields(
  apiKey,
  locationId,
  "opportunity",
);

logger.info("Opportunity custom fields fetched", {
  count: opportunityFields.customFields.length,
});

    if (Array.isArray(opportunityFields.customFields)) {
      fieldMetadata.push(
        ...opportunityFields.customFields.map((field: any) => ({
          id: field.id,
          key: field.fieldKey,
          name: field.name,
          model: "opportunity" as const,
        })),
      );
    }

    logger.info("Custom fields loaded", {
  count: fieldMetadata.length,
});

for (const field of fieldMetadata) {
  logger.info("Discovered custom field", {
    model: field.model,
    name: field.name,
    key: field.key,
    id: field.id,
  });
}

  } catch (error) {
    logger.error("Failed to load custom fields", {
      error,
    });

    logger.warn(
      "Continuing discovery without custom fields",
    );
  }

  logger.info("GoHighLevel metadata resolved", {
    pipelines: pipelineMetadata.length,
    stages: stageMetadata.length,
    customFields: fieldMetadata.length,
  });

  return {
    pipelines: pipelineMetadata,
    stages: stageMetadata,
    customFields: fieldMetadata,
  };
}