import type { CanonicalInboundMessage } from "../../../canonical/message";

export interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }>;
}

export interface MetaStatusEvent {
  providerMessageId: string;
  phoneNumberId: string;
  status: string;
  occurredAt: string;
}

export function parseMetaInboundText(payload: MetaWebhookPayload): Array<CanonicalInboundMessage & { phoneNumberId: string }> {
  const messages: Array<CanonicalInboundMessage & { phoneNumberId: string }> = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      const metadata = change.value.metadata;
      const contacts = change.value.contacts;
      const rawMessages = change.value.messages;
      if (!isRecord(metadata) || typeof metadata.phone_number_id !== "string" || !Array.isArray(rawMessages)) continue;
      for (const item of rawMessages) {
        if (!isRecord(item) || item.type !== "text" || !isRecord(item.text) || typeof item.text.body !== "string" || typeof item.id !== "string" || typeof item.from !== "string") continue;
        const timestamp = typeof item.timestamp === "string" ? Number(item.timestamp) : NaN;
        messages.push({
          provider: "meta_whatsapp",
          providerMessageId: item.id,
          locationId: metadata.phone_number_id,
          conversationId: `${metadata.phone_number_id}:${item.from}`,
          contactId: item.from,
          channel: "whatsapp",
          channelProviderId: metadata.phone_number_id,
          text: item.text.body,
          occurredAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
          phoneNumberId: metadata.phone_number_id,
        });
      }
      void contacts;
    }
  }
  return messages;
}

export function parseMetaStatusEvents(payload: MetaWebhookPayload): MetaStatusEvent[] {
  const statuses: MetaStatusEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      const metadata = change.value.metadata;
      const rawStatuses = change.value.statuses;
      if (!isRecord(metadata) || typeof metadata.phone_number_id !== "string" || !Array.isArray(rawStatuses)) continue;
      for (const item of rawStatuses) {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.status !== "string") continue;
        const timestamp = typeof item.timestamp === "string" ? Number(item.timestamp) : NaN;
        statuses.push({
          providerMessageId: item.id,
          phoneNumberId: metadata.phone_number_id,
          status: item.status,
          occurredAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return statuses;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
