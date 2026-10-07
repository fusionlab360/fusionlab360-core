import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  resolveAIProvider,
} from "../../core/ai";

import {
  extractBookingIntent,
} from "./booking-intent";


export async function testBookingIntentController(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  const body =
    await c.req.json<{
      message?:
        string;

      occurredAt?:
        string;
    }>();


  if (
    !body.message?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "message is required.",
      },

      400,
    );
  }


  const ai =
    resolveAIProvider(
      c.env.AI,
    );


  const result =
    await extractBookingIntent(

      ai,

      [],

      body.message,

      body.occurredAt ??
        new Date().toISOString(),

      null,
    );


  return c.json({

    success:
      true,

    intent:
      result,
  });
}