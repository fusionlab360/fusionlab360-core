import { getPipelines } from "./opportunities/pipelines";
import { getPipelineStages } from "./opportunities/stages";
import { getCustomFields } from "./customfields";

export interface GHLMetadata {
  pipelineId: string;
  pipelineStageId: string;
  customFields: Record<string, string>;
}

export async function resolveMetadata(
  apiKey: string,
  locationId: string,
  pipelineName: string,
  stageName: string
): Promise<GHLMetadata> {
  // Resolve Pipeline
  const { pipelines } = await getPipelines(apiKey, locationId);

  const pipeline = pipelines.find(
    (item) => item.name === pipelineName
  );

  if (!pipeline) {
    throw new Error(
      `Pipeline '${pipelineName}' not found.`
    );
  }

  // Resolve Stage
  const { stages } = await getPipelineStages(
    apiKey,
    pipeline.id
  );

  const stage = stages.find(
    (item) => item.name === stageName
  );

  if (!stage) {
    throw new Error(
      `Stage '${stageName}' not found.`
    );
  }

  // Resolve Custom Fields
  const { customFields } = await getCustomFields(
    apiKey,
    locationId
  );

  const fieldMap: Record<string, string> = {};

  for (const field of customFields) {
    fieldMap[field.name] = field.id;
  }

  return {
    pipelineId: pipeline.id,
    pipelineStageId: stage.id,
    customFields: fieldMap,
  };
}