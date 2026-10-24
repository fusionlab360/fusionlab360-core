import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../../config/app";
import { requirePermission } from "../../middleware/authorization";
import {
  MessagingConversationRepository,
  MessagingCursorError,
} from "../../persistence/repositories/messaging-conversation-repository";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export type SharedInboxReplyOutcome =
  | { state: "accepted"; providerMessageId: string }
  | { state: "retryable"; code: string }
  | { state: "permanent"; code: string }
  | { state: "unknown"; code: string };

export interface SharedInboxReplyService {
  send(input: {
    tenantId: string;
    connectionId: string;
    conversationId: string;
    recipientId: string;
    text: string;
    effectKey: string;
  }): Promise<SharedInboxReplyOutcome>;
}

export type SharedInboxReplyServiceFactory = (env: AppBindings) => SharedInboxReplyService;

function parsePageSize(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_PAGE_SIZE;
  if (!/^\d+$/.test(value)) throw new Error("The messaging page size is invalid.");
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new Error("The messaging page size is invalid.");
  }
  return size;
}

function parseReplyBody(body: unknown): { text: string; idempotencyKey: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.text !== "string" || !candidate.text.trim() || candidate.text.length > 4096) return null;
  if (typeof candidate.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(candidate.idempotencyKey)) return null;
  return { text: candidate.text, idempotencyKey: candidate.idempotencyKey };
}

export function createSharedInboxRoutes(replyServiceFactory?: SharedInboxReplyServiceFactory) {
  const routes = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();

  routes.get("/conversations", requirePermission("messaging:read"), async (c) => {
    try {
      const tenantId = c.get("context").tenant.id;
      const page = await new MessagingConversationRepository(c.env.DB).listForTenant(tenantId, {
        limit: parsePageSize(c.req.query("limit")),
        cursor: c.req.query("cursor"),
      });
      return c.json({ success: true, conversations: page.items, nextCursor: page.nextCursor });
    } catch (error) {
      if (error instanceof MessagingCursorError || error instanceof Error && error.message.includes("page size")) {
        return c.json({ success: false, message: error.message }, 400);
      }
      return c.json({ success: false, message: "Conversations are temporarily unavailable." }, 503);
    }
  });

  routes.get("/conversations/:conversationId/messages", requirePermission("messaging:read"), async (c) => {
    try {
      const tenantId = c.get("context").tenant.id;
      const conversationId = c.req.param("conversationId");
      const repository = new MessagingConversationRepository(c.env.DB);
      const conversation = await repository.findForTenant(tenantId, conversationId);
      if (!conversation) return c.json({ success: false, message: "Conversation not found." }, 404);
      const page = await repository.listMessagesForTenant(tenantId, conversationId, {
        limit: parsePageSize(c.req.query("limit")),
        cursor: c.req.query("cursor"),
      });
      return c.json({ success: true, conversation, messages: page.items, nextCursor: page.nextCursor });
    } catch (error) {
      if (error instanceof MessagingCursorError || error instanceof Error && error.message.includes("page size")) {
        return c.json({ success: false, message: error.message }, 400);
      }
      return c.json({ success: false, message: "Messages are temporarily unavailable." }, 503);
    }
  });

  routes.post("/conversations/:conversationId/messages", requirePermission("messaging:write"), async (c) => {
    const contentLength = Number(c.req.header("Content-Length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
      return c.json({ success: false, message: "The reply request is too large." }, 413);
    }
    const body = parseReplyBody(await c.req.json().catch(() => null));
    if (!body) return c.json({ success: false, message: "A non-empty text and idempotencyKey are required." }, 400);
    const tenantId = c.get("context").tenant.id;
    const conversationId = c.req.param("conversationId");
    const repository = new MessagingConversationRepository(c.env.DB);
    const conversation = await repository.findForTenant(tenantId, conversationId);
    if (!conversation) return c.json({ success: false, message: "Conversation not found." }, 404);
    if (conversation.provider !== "meta_whatsapp") {
      return c.json({ success: false, message: "Replies are not supported for this conversation provider." }, 422);
    }
    if (!replyServiceFactory) return c.json({ success: false, message: "Meta messaging is temporarily unavailable." }, 503);

    const effectKey = `${tenantId}:${conversationId}:${body.idempotencyKey}`;
    let outcome: SharedInboxReplyOutcome;
    try {
      outcome = await replyServiceFactory(c.env).send({
        tenantId,
        connectionId: conversation.connectionId,
        conversationId,
        recipientId: conversation.externalParticipantId,
        text: body.text,
        effectKey,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "MetaWhatsAppOutboundError") {
        return c.json({ success: false, message: error.message }, 409);
      }
      return c.json({ success: false, message: "The reply could not be processed." }, 503);
    }

    const message = await repository.findOutboundByEffectKey(tenantId, conversationId, effectKey);
    const status = outcome.state === "permanent" ? 502 : outcome.state === "retryable" ? 503 : 202;
    return c.json({
      success: outcome.state === "accepted" || outcome.state === "unknown",
      deliveryState: outcome.state,
      message,
      ...(outcome.state === "accepted" ? { providerMessageId: outcome.providerMessageId } : {}),
      ...(outcome.state === "retryable" || outcome.state === "permanent" || outcome.state === "unknown" ? { code: outcome.code } : {}),
    }, status);
  });

  return routes;
}

const sharedInboxRoutes = createSharedInboxRoutes();
export default sharedInboxRoutes;
