import { logger } from "../../../core/logger";

import { getPipelines } from "./opportunities/pipelines";
import { getCustomFields } from "./customfields";

import type { RequestContext } from "../../../context";

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

function errorCategory(error: unknown): string {
  if (error instanceof TypeError) return "type_error";
  if (error instanceof RangeError) return "range_error";
  if (error instanceof SyntaxError) return "syntax_error";
  return error instanceof Error ? "error" : "unknown";
}

export async function resolveMetadata(
  context: RequestContext,
  locationId: string,
): Promise<GHLMetadata> {
  logger.info("Resolving GoHighLevel metadata", {
    locationId,
  });

  logger.debug("Loading pipelines");

  const pipelineResponse = await getPipelines(
    context,
    locationId,
  );

  if (
    !pipelineResponse ||
    !Array.isArray(pipelineResponse.pipelines)
  ) {
    throw new Error(
      `Invalid pipeline response:\n${JSON.stringify(
        pipelineResponse,
        null,
        2,
      )}`,
    );
  }

  const pipelines = pipelineResponse.pipelines;
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
  context,
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
  context,
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

  } catch (error) {
    logger.error("Failed to load custom fields", {
      operation: "metadata.custom_fields.fetch",
      provider: "gohighlevel",
      correlationId: context.requestId,
      outcome: "failed",
      errorCategory: errorCategory(error),
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
