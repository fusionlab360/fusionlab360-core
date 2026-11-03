import type { AppBindings } from "../../../config/app";
import type { MetaSendOutcome, MetaWhatsAppTransport } from "./outbound";
import { classifyMetaTransportError } from "./transport-diagnostics";

const VERSION = /^v\d+\.\d+$/;

function metaProviderErrorCode(body: unknown): number | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "number" && Number.isSafeInteger(code) && code >= 0 ? code : undefined;
}

/** Thin Graph API adapter; all durable effect and tenant checks stay in outbound.ts. */
export class MetaWhatsAppGraphOutboundTransport implements MetaWhatsAppTransport {
  constructor(
    private readonly version: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!VERSION.test(version)) throw new Error("Meta WhatsApp Graph messaging is not configured.");
  }

  async sendText(input: { phoneNumberId: string; recipientId: string; text: string; accessToken: string }): Promise<MetaSendOutcome> {
    let endpoint: string;
    try {
      endpoint = new URL(`https://graph.facebook.com/${this.version}/${encodeURIComponent(input.phoneNumberId)}/messages`).toString();
    } catch {
      return { state: "unknown", code: "transport_exception", transportCategory: "invalid_url" };
    }

    let response: Response;
    try {
      // Cloudflare's global fetch must not be invoked with the transport
      // instance as its receiver. Keep dependency injection, but call the
      // captured function as a bare fetch just like the read-only diagnostic.
      const request = this.request;
      response = await request(endpoint, {
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
    } catch (error) {
      return {
        state: "unknown",
        code: "transport_exception",
        transportCategory: classifyMetaTransportError(error),
      };
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const errorCode = metaProviderErrorCode(body);
      // Meta error 190 is an authentication failure. A plain 403 can instead
      // represent permissions or policy and must not be treated as revocation.
      if (response.status === 401 || errorCode === 190) return { state: "permanent", code: "META_CREDENTIAL_INVALID" };
      if (response.status === 429 || response.status >= 500) return { state: "retryable", code: `provider_http_${response.status}` };
      return { state: "permanent", code: `provider_http_${response.status}` };
    }

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
