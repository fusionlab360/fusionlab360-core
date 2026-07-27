import type { Tenant } from "../../tenants/types";
import type { ExecutionRequest } from "./execution-request";

import type { RequestContext } from "../../context";

export interface DispatchJob<T> {
    context: RequestContext;
    request: ExecutionRequest<T>;
}