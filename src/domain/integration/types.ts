export interface ConfigureIntegrationRequest {

  pipelineId:
    string;

  providerOptions?:
    Record<string, unknown>;

}

export interface OnboardIntegrationResponse {
  success: boolean;

  workflow: {
    key: string;
    providerWorkflowId: string;
  };

  attributeMappings: number;
}

