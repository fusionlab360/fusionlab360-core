import type { RequestContext } from "../context";
import type { DispatchJob } from "./models/dispatch-job";
import type { DispatchResult } from "./models/dispatch-result";

export interface Dispatcher {
  dispatch<T, TResult>(
    jobs: DispatchJob<T>[],
    execute: (
      context: RequestContext,
      payload: T
    ) => Promise<TResult>
  ): Promise<DispatchResult<TResult>[]>;
}