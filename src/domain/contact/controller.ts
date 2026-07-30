import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import { logger } from "../../core/logger";

import {
  createContactService,
  getContactService,
  updateContactService,
  deleteContactService,
} from "./service";

export async function createContactController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  logger.info("Create contact request received");

  const body = await c.req.json();

  logger.debug("Create contact payload", body);

  const context = c.get("context");

  const result = await createContactService(
    context,
    body
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

  logger.debug("Get contact request", {
    email,
  });

  const context = c.get("context");

  const result = await getContactService(
    context,
    email
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

  logger.debug("Update contact request", {
    contactId: body.id,
  });

  const context = c.get("context");

  const result = await updateContactService(
    context,
    body
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

  logger.debug("Delete contact request", {
    contactId: body.id,
    email: body.email,
  });

  const context = c.get("context");

  const result = await deleteContactService(
    context,
    {
      id: body.id,
      email: body.email,
    }
  );

  logger.info("Contact deleted successfully");

  return c.json(result);
}