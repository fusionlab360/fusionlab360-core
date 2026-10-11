import { HTTPException } from "hono/http-exception";

import { ApiError } from "../core/errors/ApiError";
import { logger } from "../core/logger";

export function handleError(error: unknown): Response {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  if (error instanceof ApiError) {
    logger.error("API error", {
      status: error.status,
      message: error.message,
      details: error.details,
    });

    return Response.json(
      {
        success: false,
        message: error.message,
        details: error.details,
      },
      {
        status: error.status,
      },
    );
  }

  if (error instanceof Error) {
  // Avoid returning or logging raw provider error messages.
  // They may contain sensitive request details or credentials.
  logger.error("Unhandled application error", {
    errorName: error.name,
  });

  return Response.json(
    {
      success: false,
      message: "Internal Server Error",
    },
    {
      status: 500,
    },
  );
}

  logger.error("Unknown application error", {
  errorType: typeof error,
});

  return Response.json(
    {
      success: false,
      message: "Internal Server Error",
    },
    {
      status: 500,
    },
  );
}