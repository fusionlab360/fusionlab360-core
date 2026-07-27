import type { PMSCommandType } from "../commands";

export interface PMSCommand<TPayload = unknown> {
  type: PMSCommandType;

  payload: TPayload;
}