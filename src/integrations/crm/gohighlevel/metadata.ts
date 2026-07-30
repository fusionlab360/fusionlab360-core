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

  console.log("========== GHL METADATA ==========");
  console.log("Location:", locationId);

  // ----------------------------------
  // PIPELINES
  // ----------------------------------

  const pipelineResponse = await getPipelines(
    apiKey,
    locationId,
  );

  console.log(
    "Pipeline Response:",
    JSON.stringify(pipelineResponse, null, 2),
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

  const pipelineMetadata: GHLPipelineMetadata[] = pipelines.map(
    (pipeline: any) => ({
      id: pipeline.id,
      name: pipeline.name,
    }),
  );

  // ----------------------------------
  // STAGES
  // ----------------------------------

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

  // ----------------------------------
  // CUSTOM FIELDS
  // ----------------------------------

  let fieldMetadata: GHLFieldMetadata[] = [];

  try {
    const fieldResponse = await getCustomFields(
      apiKey,
      locationId,
    );

    console.log(
      "Custom Field Response:",
      JSON.stringify(fieldResponse, null, 2),
    );

    if (Array.isArray((fieldResponse as any).customFields)) {
      fieldMetadata = (fieldResponse as any).customFields.map(
        (field: any) => ({
          id: field.id,
          key: field.key,
          name: field.name,
        }),
      );
    } else {
      console.warn(
        "Custom fields endpoint returned an unexpected response. Continuing without custom fields.",
      );
    }
  } catch (error) {
  console.error("============== CUSTOM FIELDS FAILED ==============");
  console.error(error);

  fieldMetadata = [];

  console.warn("Continuing discovery without custom fields.");
}
console.log("Reached end of resolveMetadata()");

  console.log("========== RESOLVED METADATA ==========");

  console.log(
    JSON.stringify(
      {
        pipelines: pipelineMetadata,
        stages: stageMetadata,
        customFields: fieldMetadata,
      },
      null,
      2,
    ),
  );

  return {
    pipelines: pipelineMetadata,
    stages: stageMetadata,
    customFields: fieldMetadata,
  };
}