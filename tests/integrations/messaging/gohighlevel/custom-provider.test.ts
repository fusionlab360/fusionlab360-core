import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverGHLProviderOutboundMock,
  parseGHLProviderOutboundPayload,
} from "../../../../src/integrations/messaging/gohighlevel/provider-outbound";
import {
  isGHLProviderPilotLocationAuthorized,
  resolveSingleGHLProviderPilotLocation,
} from "../../../../src/integrations/messaging/gohighlevel/custom-provider-pilot-config";
import {
  publishGHLCustomInboundForTenant,
  resolveGHLConversationProviderId,
  getGHLCustomInboundFailureDiagnostics,
} from "../../../../src/integrations/messaging/gohighlevel/custom-conversation-provider";
import { ApiError } from "../../../../src/core/errors/ApiError";
import type { IntegrationContext } from "../../../../src/context/integration";
import { createIntegrationContext } from "../../../../src/context/integration";
import type { Tenant } from "../../../../src/tenants/types";

function tenant(locationId: string, providerConfiguration?: Record<string, unknown>): Tenant {
  return {
    id: "tenant-1",
    name: "Synthetic",
    status: "active",
    integrations: {
      crm: {
        id: "integration-1",
        provider: "gohighlevel",
        credentials: { locationId },
        configuration: providerConfiguration
          ? { workflow: {} as never, attributeMappings: [], providerConfiguration }
          : null,
      },
      pms: { provider: "browser" },
    },
  };
}

test("provider outbound payload validation keeps the signed callback contract narrow", () => {
  const payload = parseGHLProviderOutboundPayload({
    contactId: "contact-1",
    locationId: "location-1",
    messageId: "message-1",
    type: "SMS",
    message: "synthetic",
  });
  assert.deepEqual(payload, {
    contactId: "contact-1",
    locationId: "location-1",
    messageId: "message-1",
    type: "SMS",
    message: "synthetic",
  });
  assert.equal(parseGHLProviderOutboundPayload({ ...payload, type: "WhatsApp" }), null);
  assert.equal(parseGHLProviderOutboundPayload({ ...payload, locationId: "" }), null);
});

test("M0 outbound delivery seam is explicitly mock-only", async () => {
  const result = await deliverGHLProviderOutboundMock("tenant-1", {
    contactId: "contact-1",
    locationId: "location-1",
    messageId: "message-1",
    type: "SMS",
    message: "synthetic",
  });
  assert.deepEqual(result, { delivered: false, mode: "mock" });
});

test("pilot configuration accepts exactly one explicit location", () => {
  assert.equal(resolveSingleGHLProviderPilotLocation(undefined), null);
  assert.equal(resolveSingleGHLProviderPilotLocation(""), null);
  assert.equal(resolveSingleGHLProviderPilotLocation("location-a,location-b"), null);
  assert.equal(resolveSingleGHLProviderPilotLocation("*"), null);
  assert.equal(resolveSingleGHLProviderPilotLocation("location a"), null);
  assert.equal(resolveSingleGHLProviderPilotLocation("location_a-1"), "location_a-1");
});

test("pilot location gate rejects other registered and unknown locations", () => {
  const configuration = {
    GHL_CUSTOM_PROVIDER_ENABLED: "true",
    GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "location-a",
  };
  assert.equal(isGHLProviderPilotLocationAuthorized(configuration, "location-a"), true);
  assert.equal(isGHLProviderPilotLocationAuthorized(configuration, "location-b"), false);
  assert.equal(isGHLProviderPilotLocationAuthorized(configuration, "unknown-location"), false);
  assert.equal(isGHLProviderPilotLocationAuthorized({ ...configuration, GHL_CUSTOM_PROVIDER_ENABLED: "false" }, "location-a"), false);
  assert.equal(isGHLProviderPilotLocationAuthorized({ GHL_CUSTOM_PROVIDER_ENABLED: "true" }, "location-a"), false);
});

test("inbound publisher fails before transport for an unauthorized location or missing provider configuration", async () => {
  const context = { tenant: tenant("location-b") } as IntegrationContext;
  await assert.rejects(
    publishGHLCustomInboundForTenant(
      context,
      { contactId: "contact-1", message: "synthetic" },
      { GHL_CUSTOM_PROVIDER_ENABLED: "true", GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "location-a" },
    ),
    /not authorized/,
  );

  const configuredContext = { tenant: tenant("location-a") } as IntegrationContext;
  await assert.rejects(
    publishGHLCustomInboundForTenant(
      configuredContext,
      { contactId: "contact-1", message: "synthetic" },
      { GHL_CUSTOM_PROVIDER_ENABLED: "true", GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "location-a" },
    ),
    /not configured/,
  );
  assert.equal(resolveGHLConversationProviderId(tenant("location-a", { conversationProviderId: "provider-a" })), "provider-a");
});

test("inbound publisher uses the documented Add Inbound Message API version", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const credentials = {
    async resolve() {
      return { authType: "api_key" as const, accessToken: "synthetic-token", resourceId: "location-a" };
    },
  };
  const context = createIntegrationContext(
    tenant("location-a", { conversationProviderId: "provider-a" }),
    "gohighlevel",
    {
      transportMode: "mock",
      credentials,
      httpTransport: {
        credentials,
        async fetch(input, init) {
          requestUrl = String(input);
          requestInit = init;
          return new Response(JSON.stringify({ conversationId: "conversation-a", messageId: "message-a" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  );

  const result = await publishGHLCustomInboundForTenant(
    context,
    { contactId: "contact-a", message: "synthetic", altId: "meta-message-a" },
    { GHL_CUSTOM_PROVIDER_ENABLED: "true", GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "location-a" },
  );

  assert.deepEqual(result, { conversationId: "conversation-a", messageId: "message-a" });
  assert.equal(requestUrl, "https://services.leadconnectorhq.com/conversations/messages/inbound");
  assert.equal(new Headers(requestInit?.headers).get("Version"), "2023-02-21");
  assert.equal(JSON.parse(String(requestInit?.body)).altId, "meta-message-a");
});

test("inbound publish diagnostics expose only bounded provider code and request ID", () => {
  const diagnostics = getGHLCustomInboundFailureDiagnostics(new ApiError(
    401,
    "provider detail is not returned",
    {
      code: "OAUTH_SCOPE_MISSING",
      requestId: "req-401-example",
      message: "do not expose this body message",
      token: "do-not-expose",
    },
  ));

  assert.deepEqual(diagnostics, {
    upstreamHttpStatus: 401,
    errorCategory: "upstream_http_error",
    errorCode: "OAUTH_SCOPE_MISSING",
    providerRequestId: "req-401-example",
  });
  assert.equal(JSON.stringify(diagnostics).includes("do-not-expose"), false);
});
