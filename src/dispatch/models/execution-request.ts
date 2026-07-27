export interface ExecutionRequest<T> {
  capability: string;
  payload: T;
}