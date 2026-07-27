import type { APIClient } from "../clients/types";
import { RequestContext } from "../context";

import type { Dispatcher } from "./dispatcher";
import type { DispatchJob } from "./models/dispatch-job";
import type { DispatchResult } from "./models/dispatch-result";

import { SingleDispatcher } from "./strategies/single";

export class DispatchService {
  private readonly dispatcher: Dispatcher;

  constructor(client: APIClient) {
    this.dispatcher = new SingleDispatcher(client);
  }

  dispatch<T, TResult>(
  jobs: DispatchJob<T>[],
  execute: (
    context: RequestContext,
    payload: T
  ) => Promise<TResult>
): Promise<DispatchResult<TResult>[]> {
  return this.dispatcher.dispatch(jobs, execute);
}
}