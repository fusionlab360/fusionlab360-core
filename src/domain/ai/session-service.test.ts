
import assert from "node:assert/strict";
import test from "node:test";

import { AISessionService } from "./session-service";

import type {
  AIConversationSession,
  AIConversationSessionState,
} from "../../persistence/repositories/ai-conversation-session-repository";

import type {
  AIConversationSessionRepository,
} from "../../persistence/repositories/ai-conversation-session-repository";

const TENANT_ID = "tenant-a";
const PROVIDER = "gohighlevel";
const CONVERSATION_ID = "conversation-a";

const CURRENT_TIME = "2026-10-11T12:00:00.000Z";
const OLD_TIME = "2026-10-10T00:00:00.000Z";

function createSession(
  state: AIConversationSessionState,
  updatedAt = OLD_TIME,
): AIConversationSession {
  return {
    tenantId: TENANT_ID,
    provider: PROVIDER,
    conversationId: CONVERSATION_ID,
    state,
    sessionStartedAt: OLD_TIME,
    createdAt: OLD_TIME,
    updatedAt,
  };
}

function createHarness(
  initialSession: AIConversationSession | null,
) {
  let currentSession = initialSession;

  const updates: Array<{
    state: AIConversationSessionState;
    sessionStartedAt: string;
  }> = [];

  const repository = {
    find: async () => currentSession,

    upsert: async (
      tenantId: string,
      provider: string,
      conversationId: string,
      state: AIConversationSessionState,
      sessionStartedAt: string,
    ) => {
      updates.push({
        state,
        sessionStartedAt,
      });

      currentSession = {
        tenantId,
        provider,
        conversationId,
        state,
        sessionStartedAt,
        createdAt:
          currentSession?.createdAt ?? sessionStartedAt,
        updatedAt: CURRENT_TIME,
      };
    },
  } as unknown as AIConversationSessionRepository;

  return {
    service: new AISessionService(repository),
    updates,
    getCurrentSession: () => currentSession,
  };
}

function createInput(
  occurredAt = CURRENT_TIME,
  messageText = "I would like to book an appointment.",
) {
  return {
    tenantId: TENANT_ID,
    provider: PROVIDER,
    conversationId: CONVERSATION_ID,
    messageText,
    occurredAt,
    previousActivityAt: OLD_TIME,
    profile: {} as never,
  };
}

test("expired ordinary AI session is ignored after the inactivity window", async () => {
  const harness = createHarness(
    createSession("ai_active"),
  );

  const result = await harness.service.handleInbound(
    createInput(),
  );

  assert.equal(result.action, "ignore");
  assert.equal(result.state, "ai_active");
  assert.equal(harness.updates.length, 0);
});

test("human handoff remains protected after inactivity", async () => {
  const harness = createHarness(
    createSession("human_handoff"),
  );

  const result = await harness.service.handleInbound(
    createInput(),
  );

  assert.equal(result.action, "ignore");
  assert.equal(result.state, "human_handoff");
  assert.equal(harness.updates.length, 0);
});

test("pending handoff remains protected after inactivity", async () => {
  const harness = createHarness(
    createSession("handoff_pending"),
  );

  const result = await harness.service.handleInbound(
    createInput(),
  );

  assert.equal(result.action, "ignore");
  assert.equal(result.state, "handoff_pending");
  assert.equal(harness.updates.length, 0);

  assert.equal(
    harness.getCurrentSession()?.state,
    "handoff_pending",
  );
});

test("invalid session timestamps fail closed", async () => {
  const harness = createHarness(
    createSession("ai_active", "invalid-timestamp"),
  );

  const result = await harness.service.handleInbound(
    createInput(),
  );

  assert.equal(result.action, "ignore");
  assert.equal(result.state, "ai_active");
  assert.equal(harness.updates.length, 0);
});
