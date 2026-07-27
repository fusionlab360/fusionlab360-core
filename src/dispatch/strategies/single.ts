import type { APIClient } from "../../clients/types";
import { createRequestContext } from "../../context/factory";

import type { Dispatcher } from "../dispatcher";
import type { DispatchJob } from "../models/dispatch-job";
import type { DispatchResult } from "../models/dispatch-result";

export class SingleDispatcher implements Dispatcher {
  constructor(
    private readonly client: APIClient
  ) {}

  async dispatch<T, TResult>(
    jobs: DispatchJob<T>[],
    execute: (
      context: ReturnType<typeof createRequestContext>,
      payload: T
    ) => Promise<TResult>
  ): Promise<DispatchResult<TResult>[]> {

    const results: DispatchResult<TResult>[] = [];

   for (const job of jobs) {
    try {
        const result = await execute(
            job.context,
            job.request.payload,
        );

        results.push({
            tenantId: job.context.tenant.id,
            success: true,
            result,
        });
    } catch (error) {
        results.push({
            tenantId: job.context.tenant.id,
            success: false,
            error: error instanceof Error
                ? error
                : new Error(String(error)),
        });
    }
}

    return results;
  }
}