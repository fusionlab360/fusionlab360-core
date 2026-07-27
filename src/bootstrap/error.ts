import { HTTPException } from "hono/http-exception";
import { ApiError } from "../core/errors/ApiError";

export function handleError(error: unknown): Response {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  if (error instanceof ApiError) {
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
    console.error(error);

    return Response.json(
      {
        success: false,
        message: error.message,
      },
      {
        status: 500,
      },
    );
  }

  console.error(error);

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