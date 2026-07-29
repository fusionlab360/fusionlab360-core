import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

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
) 
{
  console.log("===== CREATE CONTACT CONTROLLER =====");

  const body = await c.req.json();

  console.log(
    "Incoming Body:",
    JSON.stringify(body, null, 2)
  );

  const context = c.get("context");

  const result = await createContactService(
    context,
    body
  );

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

  const context = c.get("context");

  const result = await updateContactService(
    context,
    body
  );

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

  const result = await deleteContactService(
    context,
    {
      id: body.id,
      email: body.email,
    }
  );

  return c.json(result);
}