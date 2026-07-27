export interface DispatchResult<TResult = unknown> {
  tenantId: string;

  success: boolean;

  result?: TResult;

  error?: Error;
}