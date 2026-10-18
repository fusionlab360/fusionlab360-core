import { createApp } from "../config/app";

import { authMiddleware } from "../middleware/auth";

import { authRoutes } from "../domain/auth/routes";

import contactRoutes from "../domain/contact/routes";

import reservationRoutes from "../domain/reservation/routes";

import bookingRoutes from "../domain/booking/routes";
import { bookingTestRoutes } from "../domain/booking/routes";

import integrationRoutes from "../domain/integration/routes";
import { integrationTestRoutes } from "../domain/integration/routes";

import messagingTestRoutes
  from "../domain/messaging/test-routes";

import messagingRoutes
  from "../domain/messaging/routes";

import aiTestRoutes
  from "../domain/ai/test-routes";

import aiRoutes
  from "../domain/ai/routes";

import oauthRoutes
  from "../domain/integration/oauth-routes";

import knowledgeRoutes
  from "../domain/knowledge/routes";

import featureRoutes from "../domain/features/routes";

import {
  evaluateRetrievalController,
} from "../domain/messaging/retrieval-evaluation-controller";
import { requirePermission } from "../middleware/authorization";

export function shouldEnableNonProductionRoutes(environment?: string): boolean {
  return environment === "development" || environment === "staging";
}

export function createApplication(environment?: string) {
const includeNonProductionRoutes = shouldEnableNonProductionRoutes(environment);
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
