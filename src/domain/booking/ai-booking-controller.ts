import type {
  Context,
} from "hono";


import type {
  AppBindings,
  AppVariables,
} from "../../config/app";


import {
  createIntegrationContext,
} from "../../context/integration";


import {
  resolveAIProvider,
} from "../../core/ai";


import {
  processAIBooking,
} from "./ai-booking-service";


export async function testAIBookingController(
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

      conversationId?:
        string;

      customerId?:
        string;

      message?:
        string;

      occurredAt?:
        string;

      timezone?:
        string;

    }>();


  if (
    !body.conversationId?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "conversationId is required.",
      },

      400,
    );
  }


  if (
    !body.customerId?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "customerId is required.",
      },

      400,
    );
  }


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


  const requestContext =
    c.get(
      "context",
    );


  const context =
  createIntegrationContext(

    requestContext.tenant,

    requestContext
      .tenant
      .integrations
      .crm
      .provider,

    requestContext.integrationRuntime,
  );


  const ai =
    resolveAIProvider(
      c.env.AI,
    );


  const result =
    await processAIBooking({

      db:
        c.env.DB,

      context,

      ai,

      history:
        [],

      currentMessage:
        body.message,

      occurredAt:
        body.occurredAt ??
        new Date().toISOString(),

      conversationId:
        body.conversationId,

      customerId:
        body.customerId,

      timezone:
        body.timezone ??
        "Asia/Kuala_Lumpur",
    });


  return c.json({

    success:
      true,

    result,
  });
}