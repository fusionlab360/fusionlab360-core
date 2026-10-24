import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import { logger } from "../../core/logger";
import { ApiError } from "../../core/errors/ApiError";

import {
  createContactService,
  getContactService,
  updateContactService,
  deleteContactService,
} from "./service";

async function runContactOperation<T>(
  context: AppVariables["context"],
  operation: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApiError) {
      logger.error("Contact provider operation failed", {
        operation,
        provider: context.tenant.integrations.crm.provider,
        correlationId: context.requestId,
        outcome: "failed",
        providerStatus: error.status,
        errorCategory: "provider_error",
      });

      throw new ApiError(
        error.status,
        "Contact operation failed.",
      );
    }

    throw error;
  }
}

export async function createContactController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  const body = await c.req.json();

  const context = c.get("context");

  logger.info("Create contact request received", {
    operation: "contact.create",
    provider: context.tenant.integrations.crm.provider,
    correlationId: context.requestId,
    suppliedFields: {
      firstName: Boolean(body.firstName),
      lastName: Boolean(body.lastName),
      email: Boolean(body.email),
      phone: Boolean(body.phone),
      identityNumber: Boolean(body.identityNumber),
      notes: Boolean(body.notes),
      branch: Boolean(body.branch),
    },
  });

  const result = await runContactOperation(
    context,
    "contact.create",
    () => createContactService(
      context,
      body,
    ),
  );

  logger.info("Contact created successfully");

  return c.json(result);
}

export async function getContactController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  const email = c.req.query("email");

  if (!email) {
    return c.json(
      { message: "Email is required." },
      400
    );
  }

  const context = c.get("context");

  logger.info("Get contact request received", {
    operation: "contact.read",
    provider: context.tenant.integrations.crm.provider,
    correlationId: context.requestId,
    emailProvided: Boolean(email),
  });

  const result = await runContactOperation(
    context,
    "contact.read",
    () => getContactService(
      context,
      email,
    ),
  );

  return c.json(result);
}

export async function updateContactController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  const body = await c.req.json();

  if (!body.id) {
    return c.json(
      { message: "Contact ID is required." },
      400
    );
  }

  const context = c.get("context");

  logger.info("Update contact request received", {
    operation: "contact.update",
    provider: context.tenant.integrations.crm.provider,
    correlationId: context.requestId,
  });

  const result = await runContactOperation(
    context,
    "contact.update",
    () => updateContactService(
      context,
      body,
    ),
  );

  logger.info("Contact updated successfully", {
    contactId: body.id,
  });

  return c.json(result);
}

export async function deleteContactController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  const body = await c.req.json();

  if (!body.id && !body.email) {
    return c.json(
      {
        message:
          "Either Contact ID or Email is required.",
      },
      400
    );
  }

  const context = c.get("context");

  logger.info("Delete contact request received", {
    operation: "contact.delete",
    provider: context.tenant.integrations.crm.provider,
    correlationId: context.requestId,
    identifierType: body.id ? "contact_id" : "email",
  });

  const result = await runContactOperation(
    context,
    "contact.delete",
    () => deleteContactService(
      context,
      {
        id: body.id,
        email: body.email,
      },
    ),
  );

  logger.info("Contact deleted successfully");

  return c.json(result);
}
