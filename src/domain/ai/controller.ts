import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  AIAgentProfileRepository,
} from "../../persistence/repositories/ai-agent-profile-repository";

import {
  AIAgentProfileService,
} from "./profile-service";


function createProfileService(
  db:
    D1Database,
):
  AIAgentProfileService {

  const repository =
    new AIAgentProfileRepository(
      db,
    );


  return new AIAgentProfileService(
    repository,
  );
}


/**
 * GET /ai/profile
 *
 * Returns the tenant's AI agent profile.
 */
export async function getAIProfile(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  const context =
    c.get(
      "context",
    );


  const service =
    createProfileService(
      c.env.DB,
    );


  const profile =
    await service.getOrCreate(
      context.tenant.id,

      context.tenant.name,
    );


  return c.json({
    success:
      true,

    profile,
  });
}


/**
 * PUT /ai/profile
 *
 * Updates the tenant's AI agent profile.
 */
export async function updateAIProfile(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  const context =
    c.get(
      "context",
    );


  const body =
    await c.req.json<{
      agentName?:
        string;

      businessName?:
        string;

      businessType?:
        string;

      greetingTemplate?:
        string;

      handoffTemplate?:
        string;

      systemInstructions?:
        string;

      aiInstructionsKnowledgeBaseId?:
        string;
    }>();


  const service =
    createProfileService(
      c.env.DB,
    );


  const existing =
    await service.getOrCreate(
      context.tenant.id,

      context.tenant.name,
    );


  const updates: {

    agentName?:
      string;

    businessName?:
      string;

    businessType?:
      string;

    greetingTemplate?:
      string;

    handoffTemplate?:
      string;

    systemInstructions?:
      string;

    aiInstructionsKnowledgeBaseId?:
      string;

  } = {};


  if (
    typeof body.agentName ===
    "string"
  ) {

    updates.agentName =
      body.agentName.trim();
  }


  if (
    typeof body.businessName ===
    "string"
  ) {

    updates.businessName =
      body.businessName.trim();
  }


  if (
    typeof body.businessType ===
    "string"
  ) {

    updates.businessType =
      body.businessType.trim();
  }


  if (
    typeof body.greetingTemplate ===
    "string"
  ) {

    updates.greetingTemplate =
      body.greetingTemplate.trim();
  }


  if (
    typeof body.handoffTemplate ===
    "string"
  ) {

    updates.handoffTemplate =
      body.handoffTemplate.trim();
  }


  if (
    typeof body.systemInstructions ===
    "string"
  ) {

    updates.systemInstructions =
      body.systemInstructions.trim();
  }


  if (
    typeof body.aiInstructionsKnowledgeBaseId ===
    "string"
  ) {

    updates.aiInstructionsKnowledgeBaseId =
      body.aiInstructionsKnowledgeBaseId.trim();
  }


  const profile =
    await service.update(
      context.tenant.id,

      existing,

      updates,
    );


  return c.json({
    success:
      true,

    profile,
  });
}