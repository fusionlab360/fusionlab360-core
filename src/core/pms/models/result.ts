export interface PMSResult<TResult = unknown> {
  success: boolean;

  data?: TResult;

  error?: string;
}