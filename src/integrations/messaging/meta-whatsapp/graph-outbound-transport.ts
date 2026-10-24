import type { AppBindings } from "../../../config/app";
import type { MetaSendOutcome, MetaWhatsAppTransport } from "./outbound";

const VERSION = /^v\d+\.\d+$/;

/** Thin Graph API adapter; all durable effect and tenant checks stay in outbound.ts. */
export class MetaWhatsAppGraphOutboundTransport implements MetaWhatsAppTransport {
  constructor(
    private readonly version: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!VERSION.test(version)) throw new Error("Meta WhatsApp Graph messaging is not configured.");
  }

  async sendText(input: { phoneNumberId: string; recipientId: string; text: string; accessToken: string }): Promise<MetaSendOutcome> {
    let response: Response;
    try {
      response = await this.request(`https://graph.facebook.com/${this.version}/${encodeURIComponent(input.phoneNumberId)}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.recipientId,
          type: "text",
          text: { body: input.text },
        }),
      });
    } catch {
      return { state: "unknown", code: "transport_exception" };
    }

    if (response.status === 401 || response.status === 403) return { state: "permanent", code: "provider_unauthorized" };
    if (response.status === 429 || response.status >= 500) return { state: "retryable", code: `provider_http_${response.status}` };
    if (!response.ok) return { state: "permanent", code: `provider_http_${response.status}` };

    const body: unknown = await response.json().catch(() => null);
    const messages = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).messages
      : undefined;
    const providerMessageId = Array.isArray(messages) && messages[0] && typeof messages[0] === "object"
      ? (messages[0] as Record<string, unknown>).id
      : undefined;
    return typeof providerMessageId === "string" && providerMessageId.trim()
      ? { state: "accepted", providerMessageId: providerMessageId.trim() }
      : { state: "unknown", code: "provider_response_malformed" };
  }
}

export function createMetaWhatsAppGraphOutboundTransport(bindings: Pick<AppBindings, "META_WHATSAPP_GRAPH_API_VERSION">): MetaWhatsAppGraphOutboundTransport {
  return new MetaWhatsAppGraphOutboundTransport(bindings.META_WHATSAPP_GRAPH_API_VERSION ?? "");
}
