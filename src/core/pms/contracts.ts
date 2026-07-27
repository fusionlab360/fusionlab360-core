import type { RequestContext } from "../../context";
import type { PMSCommand } from "./models/command";
import type { PMSResult } from "./models/result";

export interface PMSAdapter {
  execute<TResult = unknown>(
    context: RequestContext,
    command: PMSCommand
  ): Promise<PMSResult<TResult>>;
}