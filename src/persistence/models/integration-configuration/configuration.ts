import type { AttributeMapping } from "./attribute-mapping";
import type { Workflow } from "./workflow";

export interface IntegrationConfiguration {
  workflow: Workflow;

  attributeMappings: AttributeMapping[];

  providerConfiguration?: Record<
    string,
    unknown
  >;
}