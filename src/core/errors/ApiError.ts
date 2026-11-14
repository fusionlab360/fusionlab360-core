export const API_ERROR_CODES = [
  "API_ERROR",
  "UPSTREAM_FAILURE",
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code: ApiErrorCode = "API_ERROR",
  ) {
    super(message);
    this.name = "ApiError";
  }
}
