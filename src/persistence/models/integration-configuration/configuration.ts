import type { Workflow } from "./workflow";
import type { AttributeMapping } from "./attribute-mapping";

export interface IntegrationConfiguration {
  workflow: Workflow;
  attributeMappings: AttributeMapping[];
}