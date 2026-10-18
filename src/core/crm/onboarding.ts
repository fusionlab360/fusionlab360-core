import type { RequestContext } from "../../context";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

export interface CRMPreviewResult {
  provider: string;
  locationId: string;
  pipelines: {
    id: string;
    name: string;
  }[];
    stages: number;
    customFields: number;
}

export interface CRMOnboarding {
  preview(
    context: RequestContext,
  ): Promise<CRMPreviewResult>;

  configure(
    context: RequestContext,
    pipelineId: string,
    providerOptions?: Record<string, unknown>,
  ): Promise<IntegrationConfiguration>;
}