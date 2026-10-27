import { createApp } from "../config/app";

import { authMiddleware } from "../middleware/auth";

import { authRoutes } from "../domain/auth/routes";

import contactRoutes from "../domain/contact/routes";

import reservationRoutes from "../domain/reservation/routes";

import bookingRoutes from "../domain/booking/routes";
import { bookingTestRoutes } from "../domain/booking/routes";

import integrationRoutes from "../domain/integration/routes";
import {
  integrationPilotRoutes,
  integrationTestRoutes,
} from "../domain/integration/routes";
import staahManagementRoutes, {
  type createSTAAHRoutes,
} from "../integrations/channel-manager/staah/staah-routes";

import messagingTestRoutes
  from "../domain/messaging/test-routes";

import messagingRoutes
  from "../domain/messaging/routes";
import { createSharedInboxRoutes }
  from "../domain/messaging/shared-inbox-routes";
import { createMetaWhatsAppOutboundService } from "../integrations/messaging/meta-whatsapp/outbound";

import aiTestRoutes
  from "../domain/ai/test-routes";

import aiRoutes
  from "../domain/ai/routes";

import oauthRoutes
  from "../domain/integration/oauth-routes";

import knowledgeRoutes
  from "../domain/knowledge/routes";

import featureRoutes from "../domain/features/routes";
import metaWhatsAppRoutes from "../integrations/messaging/meta-whatsapp/routes";
import { metaWhatsAppWebhookController } from "../integrations/messaging/meta-whatsapp/webhook-controller";

import {
  evaluateRetrievalController,
} from "../domain/messaging/retrieval-evaluation-controller";
import { requirePermission } from "../middleware/authorization";
import { createConsoleServiceRoutes } from "../domain/console-service/routes";
import type { MessagingProvider } from "../core/messaging";

export function shouldEnableNonProductionRoutes(environment?: string): boolean {
  return environment === "development" || environment === "staging";
}

export function createApplication(
  environment?: string,
  localSTAAHRoutes?: ReturnType<typeof createSTAAHRoutes>,
  manualReplyProvider?: MessagingProvider,
) {
  // A trusted local route override is never accepted by
  // staging or production application composition.
  if (localSTAAHRoutes && environment !== "development") {
    throw new Error("Local STAAH mock routes require development composition.");
  }

  const includeNonProductionRoutes =
    shouldEnableNonProductionRoutes(environment);
const app = createApp();


/*
 * --------------------------------------------------
 * Public routes
 * --------------------------------------------------
 */

app.get(
  "/",
  (c) => {
    return c.json({
      name:
        "FusionLab360 API",

      version:
        "1.0.0",

      status:
        "running",
    });
  },
);


app.get(
  "/health",
  (c) => {
    return c.json({
      success:
        true,

      message:
        "API is healthy",
    });
  },
);


/*
 * --------------------------------------------------
 * Authentication
 * --------------------------------------------------
 */

app.route(
  "/auth",
  authRoutes,
);


/*
 * --------------------------------------------------
 * GHL Webhooks
 * --------------------------------------------------
 *
 * These routes are NOT protected by FusionLab360's
 * Bearer authentication.
 *
 * Authentication is performed inside the webhook
 * controller using the GHL webhook signature.
 */

app.route(
  "/webhooks/gohighlevel",
  messagingRoutes,
);

app.all("/webhooks/meta-whatsapp", metaWhatsAppWebhookController);


/*
 * --------------------------------------------------
 * Protected route middleware
 * --------------------------------------------------
 */

app.use(
  "/contacts/*",
  authMiddleware,
);

app.use(
  "/reservations/*",
  authMiddleware,
);

app.use("/booking/*", authMiddleware);



app.use(
  "/integrations/*",
  authMiddleware,
);

if (includeNonProductionRoutes) {
  app.use("/messaging-test/*", authMiddleware);
  app.use("/ai-test/*", authMiddleware);
}

app.use("/messaging", authMiddleware);
app.use("/messaging/*", authMiddleware);

app.use(
  "/ai/*",
  authMiddleware,
);


/*
 * --------------------------------------------------
 * Contact
 * --------------------------------------------------
 */

app.route(
  "/contacts",
  contactRoutes,
);


/*
 * --------------------------------------------------
 * Reservation
 * --------------------------------------------------
 */

app.route(
  "/reservations",
  reservationRoutes,
);


/*
 * --------------------------------------------------
 * Booking
 * --------------------------------------------------
 */

app.route("/booking", bookingRoutes);
if (includeNonProductionRoutes) {
  app.route("/booking", bookingTestRoutes);
}


/*
 * --------------------------------------------------
 * Integration
 * --------------------------------------------------
 */

app.route(
  "/integrations",
  integrationRoutes,
);
// Operator diagnostics and synthetic pilot routes are development/staging-only.
// Production retains the canonical integration APIs and GHL callback routes,
// but does not expose these temporary operations.
if (includeNonProductionRoutes) {
  app.route("/integrations", integrationPilotRoutes);
}
app.route("/integrations/meta-whatsapp", metaWhatsAppRoutes);
app.route(
  "/channel-manager/staah",
  localSTAAHRoutes ?? staahManagementRoutes,
);
if (includeNonProductionRoutes) {
  app.route("/integrations", integrationTestRoutes);
}


/*
 * --------------------------------------------------
 * Messaging development/test routes
 * --------------------------------------------------
 */

if (includeNonProductionRoutes) {
  app.route("/messaging-test", messagingTestRoutes);
}


/*
 * --------------------------------------------------
 * AI development/test routes
 * --------------------------------------------------
 */

if (includeNonProductionRoutes) {
  app.route("/ai-test", aiTestRoutes);
}


/*
 * --------------------------------------------------
 * AI production routes
 * --------------------------------------------------
 */

app.route(
  "/ai",
  aiRoutes,
);

app.route("/messaging", createSharedInboxRoutes((env) => createMetaWhatsAppOutboundService(env)));
app.route("/internal/console", createConsoleServiceRoutes(manualReplyProvider));

/*
 * --------------------------------------------------
 * OAuth routes
 * --------------------------------------------------
 */

app.route(
  "/oauth",
  oauthRoutes,
);

/*
 * --------------------------------------------------
 * Knowledge routes
 * --------------------------------------------------
 */

app.use(
  "/knowledge/*",
  authMiddleware,
);

/*
 * --------------------------------------------------
 * Authenticated retrieval evaluation
 * --------------------------------------------------
 */

if (includeNonProductionRoutes) {
  app.post(
    "/knowledge/evaluate",
    requirePermission("knowledge:evaluate"),
    evaluateRetrievalController,
  );
}

/*
 * --------------------------------------------------
 * Knowledge
 * --------------------------------------------------
 */

app.route(
  "/knowledge",
  knowledgeRoutes,
);




app.use("/features", authMiddleware);
app.use("/features/*", authMiddleware);
app.route("/features", featureRoutes);

return app;
}
