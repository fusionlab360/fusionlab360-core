import type { RequestContext } from "../../context";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

export interface PreviewResult {
  provider: string;
  locationId: string;

  pipelines: Array<{
    id: string;
    name: string;
  }>;

  stages: number;
  customFields: number;
}

export interface ConfigureResult {
  configuration: IntegrationConfiguration;
}

export interface OnboardingService {

  preview(
    context: RequestContext,
  ): Promise<PreviewResult>;

  configure(
    db: D1Database,
    context: RequestContext,
    pipelineId: string,
  ): Promise<ConfigureResult>;
}