export interface OpportunityAttribute {
  key: string;
  value: unknown;
}

export interface Opportunity {
  id?: string;

  name: string;

  pipelineId?: string;

  pipelineStageId?: string;

  status?: string;

  monetaryValue?: number;

  source?: string;

  contactId?: string;

  attributes?: OpportunityAttribute[];

  [key: string]: unknown;
}