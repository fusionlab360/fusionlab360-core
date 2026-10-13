import assert from "node:assert/strict";
import test from "node:test";
import { IntegrationEventService } from "./service";
import type { IntegrationEventRepository } from "../../persistence/repositories/integration-event-repository";

test("event acceptance scopes idempotency by tenant and provider while recognizing legacy IDs", async () => {
  const records = new Map<string, string>();
  const repository = {
    async findByExternalIdentity(tenantId: string, provider: string, sourceId: string) {
      return records.get(JSON.stringify([tenantId, provider, sourceId])) ?? null;
    },
    async createIfAbsent(event: { tenantId: string; provider: string; externalEventId: string; eventId: string }) {
      records.set(
        JSON.stringify([event.tenantId, event.provider, event.externalEventId]),
        event.eventId,
      );
      return true;
    },
  } as unknown as IntegrationEventRepository;
  const service = new IntegrationEventService(repository);
  const base = {
    eventId: "provider-message-1",
    eventType: "messaging.inbound",
    aggregateType: "conversation",
    aggregateId: "conversation-1",
    provider: "gohighlevel",
    occurredAt: "2026-10-13T00:00:00.000Z",
    payload: { text: "private" },
  };

  const first = await service.accept({ ...base, tenantId: "tenant-a" });
  const duplicate = await service.accept({ ...base, tenantId: "tenant-a" });
  const otherTenant = await service.accept({ ...base, tenantId: "tenant-b" });

  assert.equal(first.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.event.eventId, first.event.eventId);
  assert.notEqual(first.event.eventId, otherTenant.event.eventId);
});
