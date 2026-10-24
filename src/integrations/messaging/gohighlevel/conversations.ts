import { ghlFetchAuthenticated } from "../../crm/gohighlevel/client";
import type { IntegrationContext } from "../../../context/integration";

export interface GHLConversationSummary {
  id: string;
  provider: "gohighlevel";
  channel: string;
  connectionId: string;
  externalParticipantId: string;
  externalConversationId: string;
  createdAt: string;
  updatedAt: string;
  contactId?: string;
  locationId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  direction?: string;
  unreadCount?: number;
  status?: string;
}

interface SearchResponse { conversations?: unknown[]; total?: number; meta?: { nextPage?: number | string | null }; }

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

export async function searchGHLConversations(context: IntegrationContext, input: { limit?: number; page?: number } = {}): Promise<{ items: GHLConversationSummary[]; nextPage: number | null }> {
  const locationId = context.tenant.integrations.crm.credentials.locationId?.trim();
  if (!locationId) throw new Error("GHL Location is not configured.");
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const query = new URLSearchParams({ locationId, limit: String(limit), page: String(page) });
  const response = await ghlFetchAuthenticated<SearchResponse>(context, `/conversations/search?${query}`, { headers: { Version: "v3" } });
  if (!record(response)) throw new Error("GoHighLevel conversation search returned an invalid response.");
  if (response.conversations !== undefined && !Array.isArray(response.conversations)) throw new Error("GoHighLevel conversation search returned an invalid response.");
  const rows = Array.isArray(response.conversations) ? response.conversations : [];
  const items = rows.map((value): GHLConversationSummary | null => {
    const row = record(value); const id = stringValue(row?.id) ?? stringValue(row?.conversationId);
    if (!id) return null;
    const contactId = stringValue(row?.contactId);
    const updatedAt = stringValue(row?.lastMessageDate) ?? stringValue(row?.lastMessageAt) ?? stringValue(row?.dateUpdated) ?? new Date().toISOString();
    return { id, provider: "gohighlevel", channel: stringValue(row?.type) ?? stringValue(row?.channel) ?? "unknown", connectionId: stringValue(row?.locationId) ?? locationId, externalParticipantId: contactId ?? "unknown", externalConversationId: id, createdAt: stringValue(row?.dateAdded) ?? updatedAt, updatedAt, contactId, locationId: stringValue(row?.locationId) ?? locationId, lastMessage: stringValue(row?.lastMessageBody) ?? stringValue(row?.lastMessage), lastMessageAt: updatedAt, direction: stringValue(row?.lastMessageDirection), unreadCount: numberValue(row?.unreadCount), status: stringValue(row?.status) };
  }).filter((item): item is GHLConversationSummary => item !== null);
  const next = response.meta?.nextPage;
  return { items, nextPage: typeof next === "number" ? next : typeof next === "string" && /^\d+$/.test(next) ? Number(next) : null };
}
