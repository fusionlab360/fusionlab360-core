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

  let fieldMetadata: GHLFieldMetadata[] = [];

  try {
    logger.debug("Loading custom fields");

    const fieldResponse = await getCustomFields(
      apiKey,
      locationId,
    );

    if (Array.isArray((fieldResponse as any).customFields)) {
      fieldMetadata = (fieldResponse as any).customFields.map(
        (field: any) => ({
          id: field.id,
          key: field.fieldKey,
          name: field.name,
        }),
      );

      logger.debug("Custom fields loaded", {
        count: fieldMetadata.length,
      });
    } else {
      logger.warn(
        "Custom fields endpoint returned an unexpected response",
      );
    }
  } catch (error) {
    logger.error("Failed to load custom fields", {
      error,
    });

    fieldMetadata = [];

    logger.warn("Continuing discovery without custom fields");
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