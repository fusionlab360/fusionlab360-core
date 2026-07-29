import type { State } from "./state";

export interface Workflow {
  key: string;

  providerWorkflowId: string;

  states: State[];
}