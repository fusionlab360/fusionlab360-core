
import assert from "node:assert/strict";
import test from "node:test";

import { AISessionService } from "../../../src/domain/ai/session-service";

import type {
  AIConversationSession,
  AIConversationSessionState,
} from "../../../src/persistence/repositories/ai-conversation-session-repository";

import type {
  AIConversationSessionRepository,
} from "../../../src/persistence/repositories/ai-conversation-session-repository";

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
    tenantId: string;
    provider: string;
    conversationId: string;
    state: AIConversationSessionState;
    sessionStartedAt: string;
  }> = [];
  const findCalls: Array<{
    tenantId: string;
    provider: string;
    conversationId: string;
  }> = [];

  const repository = {
    find: async (
      tenantId: string,
      provider: string,
      conversationId: string,
    ) => {
      findCalls.push({ tenantId, provider, conversationId });
      return currentSession;
    },

    upsert: async (
      tenantId: string,
      provider: string,
      conversationId: string,
      state: AIConversationSessionState,
      sessionStartedAt: string,
    ) => {
      updates.push({
        tenantId,
        provider,
        conversationId,
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
    findCalls,
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
    profile: {
      agentName: "NUVI",
      businessName: "Test Clinic",
      businessType: "clinic",
      handoffTemplate: "I will connect you with {{businessName}}.",
    } as never,
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

test("accepting a pending handoff transitions to human control and returns the configured response", async () => {
  const harness = createHarness(
    createSession("handoff_pending", CURRENT_TIME),
  );

  const result = await harness.service.handleInbound(
    createInput(CURRENT_TIME, "Yes."),
  );

  assert.equal(result.action, "handoff");
  assert.equal(result.state, "human_handoff");
  assert.equal(result.response, "I will connect you with Test Clinic.");
  assert.equal(harness.getCurrentSession()?.state, "human_handoff");
  assert.deepEqual(harness.updates.map((update) => update.state), ["human_handoff"]);
  assert.deepEqual(harness.updates[0], {
    tenantId: TENANT_ID,
    provider: PROVIDER,
    conversationId: CONVERSATION_ID,
    state: "human_handoff",
    sessionStartedAt: OLD_TIME,
  });
});

test("declining a pending handoff returns to AI and supported follow-up continues normally", async () => {
  const harness = createHarness(
    createSession("handoff_pending", CURRENT_TIME),
  );

  const decline = await harness.service.handleInbound(
    createInput(CURRENT_TIME, "No, thanks."),
  );
  const followUp = await harness.service.handleInbound(
    createInput("2026-10-11T12:01:00.000Z", "Is parking available?"),
  );

  assert.deepEqual(
    [decline.action, decline.state],
    ["ai", "ai_active"],
  );
  assert.deepEqual(
    [followUp.action, followUp.state],
    ["ai", "ai_active"],
  );
  assert.deepEqual(
    harness.updates.map((update) => update.state),
    ["ai_active", "ai_active"],
  );
});

test("an explicit later human request reopens a declined handoff", async () => {
  const harness = createHarness(
    createSession("handoff_pending", CURRENT_TIME),
  );

  await harness.service.handleInbound(
    createInput(CURRENT_TIME, "No, thanks."),
  );
  const request = await harness.service.handleInbound(
    createInput("2026-10-11T12:01:00.000Z", "I want to speak to a person."),
  );

  assert.equal(request.action, "handoff");
  assert.equal(request.state, "human_handoff");
  assert.equal(request.response, "I will connect you with Test Clinic.");
  assert.equal(harness.getCurrentSession()?.state, "human_handoff");
});

test("an unrelated yes in an active AI session does not trigger handoff", async () => {
  const harness = createHarness(
    createSession("ai_active", CURRENT_TIME),
  );

  const result = await harness.service.handleInbound(
    createInput(CURRENT_TIME, "Yes."),
  );

  assert.equal(result.action, "ai");
  assert.equal(result.state, "ai_active");
  assert.equal(harness.getCurrentSession()?.state, "ai_active");
  assert.deepEqual(harness.updates.map((update) => update.state), ["ai_active"]);
});

test("customer acceptance cannot move an already human-controlled session", async () => {
  const harness = createHarness(
    createSession("human_handoff", CURRENT_TIME),
  );

  const result = await harness.service.handleInbound(
    createInput(CURRENT_TIME, "Yes."),
  );

  assert.equal(result.action, "ignore");
  assert.equal(result.state, "human_handoff");
  assert.equal(harness.getCurrentSession()?.state, "human_handoff");
  assert.equal(harness.updates.length, 0);
});

test("session lookup remains scoped by tenant, provider, and conversation", async () => {
  const harness = createHarness(
    createSession("ai_active", CURRENT_TIME),
  );

  await harness.service.handleInbound(createInput(CURRENT_TIME, "Is parking available?"));

  assert.deepEqual(harness.findCalls, [
    {
      tenantId: TENANT_ID,
      provider: PROVIDER,
      conversationId: CONVERSATION_ID,
    },
  ]);
  assert.ok(
    harness.updates.every(
      (update) =>
        update.tenantId === TENANT_ID &&
        update.provider === PROVIDER &&
        update.conversationId === CONVERSATION_ID,
    ),
  );
});
