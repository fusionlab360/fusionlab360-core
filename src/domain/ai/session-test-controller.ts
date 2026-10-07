import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  AIConversationSessionRepository,
} from "../../persistence/repositories/ai-conversation-session-repository";

import {
  AIAgentProfileRepository,
} from "../../persistence/repositories/ai-agent-profile-repository";

import {
  AISessionService,
} from "./session-service";

import {
  AIAgentProfileService,
} from "./profile-service";


export async function testAISessionController(
  c: Context<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>,
) {

  /*
   * --------------------------------------------------
   * 1. Parse request
   * --------------------------------------------------
   */

  const body =
    await c.req.json<{
      conversationId?: string;

      messageText?: string;

      occurredAt?: string;

      previousActivityAt:
        string | null;

      provider?: string;
    }>();


  /*
   * --------------------------------------------------
   * 2. Validate request
   * --------------------------------------------------
   */

  if (
    !body.conversationId ||
    !body.messageText
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "conversationId and messageText are required.",
      },
      400,
    );
  }


  /*
   * --------------------------------------------------
   * 3. Request context
   * --------------------------------------------------
   */

  const context =
    c.get("context");


  /*
   * --------------------------------------------------
   * 4. Resolve provider
   * --------------------------------------------------
   */

  const provider =
    body.provider ??
    "gohighlevel";


  /*
   * --------------------------------------------------
   * 5. Resolve message timestamp
   * --------------------------------------------------
   */

  const occurredAt =
    body.occurredAt ??
    new Date().toISOString();


  /*
   * --------------------------------------------------
   * 6. Load / create tenant AI profile
   * --------------------------------------------------
   */

  const profileRepository =
    new AIAgentProfileRepository(
      c.env.DB,
    );


  const profileService =
    new AIAgentProfileService(
      profileRepository,
    );


  const profile =
    await profileService.getOrCreate(
      context.tenant.id,
      context.tenant.name,
    );


  /*
   * --------------------------------------------------
   * 7. Session repository
   * --------------------------------------------------
   */

  const sessionRepository =
    new AIConversationSessionRepository(
      c.env.DB,
    );


  /*
   * --------------------------------------------------
   * 8. Session service
   * --------------------------------------------------
   */

  const service =
    new AISessionService(
      sessionRepository,
    );


  /*
   * --------------------------------------------------
   * 9. Process inbound message
   * --------------------------------------------------
   */

  const decision =
    await service.handleInbound({
      tenantId:
        context.tenant.id,

      provider,

      conversationId:
        body.conversationId,

      messageText:
        body.messageText,

      occurredAt,

      previousActivityAt:
        body.previousActivityAt ??
        null,

      profile,
    });


  /*
   * --------------------------------------------------
   * 10. Return test result
   * --------------------------------------------------
   */

  return c.json({
    success:
      true,

    tenantId:
      context.tenant.id,

    provider,

    conversationId:
      body.conversationId,

    agent: {
      name:
        profile.agentName,

      businessName:
        profile.businessName,

      businessType:
        profile.businessType,
    },

    decision,
  });
}