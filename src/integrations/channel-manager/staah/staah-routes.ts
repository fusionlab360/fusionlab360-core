import { Hono } from "hono";
import type { Context } from "hono";
import type { AppBindings, AppVariables } from "../../../config/app";
import { requireTenantClientPermission } from "../../../middleware/authorization";
import {
  STAAHConnectionManagementService,
  STAAHManagementError,
} from "./staah-management";
import { STAAHMockSynchronizationService, STAAHSyncError } from "./staah-sync";
import {
  STAAHMockARIService,
  STAAHARIError,
} from "./staah-ari";

import {
  STAAHMockBookingError,
} from "./staah-mock-booking-contracts";

import type {
  STAAHMockSubmissionOutcome,
} from "./staah-mock-booking-submission";

export interface STAAHRoutesDependencies {
  createSyncService?: (
    db: D1Database,
  ) => STAAHMockSynchronizationService;

  submitMockBooking?: (
    tenantId: string,
    integrationId: string,
    input: unknown,
  ) => Promise<STAAHMockSubmissionOutcome>;
}

export function createSTAAHRoutes(
  dependencies: STAAHRoutesDependencies = {},
) {
  const routes = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();

async function respond(
  c: Context<{ Bindings: AppBindings; Variables: AppVariables }>,
  operation: (service: STAAHConnectionManagementService, tenantId: string) => Promise<Record<string, unknown>>,
) {
  const principal = c.get("principal");
  if (!principal) {
    return c.json({ success: false, message: "Unauthorized." }, 401);
  }
  try {
    const result = await operation(
      new STAAHConnectionManagementService(c.env.DB),
      principal.tenantId,
    );
    return c.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof STAAHManagementError) {
      return c.json({ success: false, code: error.code, message: error.message }, error.status);
    }
    console.error("STAAH mock connection operation failed.", {
      operation: "tenant_scoped_mock_management",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return c.json({ success: false, code: "persistence_failure", message: "STAAH connection operation is temporarily unavailable." }, 503);
  }
}

routes.get(
  "/",
  requireTenantClientPermission("integrations:read"),
  (c) => respond(c, async (service, tenantId) => ({
    connection: await service.inspect(tenantId),
  })),
);

/**
 * M6.2C — Tenant-scoped, read-only synthetic STAAH ARI.
 *
 * GET /channel-manager/staah/:integrationId/ari
 *   ?startDate=2030-04-10&endDate=2030-04-16
 *
 * Authentication:
 * - existing tenant API-key middleware
 * - integrations:read permission
 * - tenant identity from authenticated principal
 *
 * No live STAAH calls, database writes or GHL delivery.
 */
routes.get(
  "/:integrationId/ari",
  requireTenantClientPermission("integrations:read"),
  async (c) => {
    const principal = c.get("principal");

    if (!principal) {
      return c.json(
        {
          success: false,
          message: "Unauthorized.",
        },
        401,
      );
    }

    const startDate = c.req.query("startDate") ?? "";
    const endDate = c.req.query("endDate") ?? "";

    try {
      const management = new STAAHConnectionManagementService(
        c.env.DB,
      );

      const service = new STAAHMockARIService(management);

      const ari = await service.retrieve(
        principal.tenantId,
        c.req.param("integrationId"),
        {
          startDate,
          endDate,
        },
      );

      return c.json({
        success: true,
        provider: "staah",
        mode: "mock",
        tenantId: principal.tenantId,
        integrationId: c.req.param("integrationId"),
        ari,
      });
    } catch (error: unknown) {
      if (
        error instanceof STAAHManagementError ||
        error instanceof STAAHARIError
      ) {
        return c.json(
          {
            success: false,
            code: error.code,
            message: error.message,
          },
          error.status,
        );
      }

      console.error("STAAH synthetic ARI retrieval failed.", {
        operation: "tenant_scoped_mock_ari",
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      });

      return c.json(
        {
          success: false,
          code: "ari_unavailable",
          message:
            "Synthetic STAAH availability and rates are temporarily unavailable.",
        },
        503,
      );
    }
  },
);

routes.post(
  "/",
  requireTenantClientPermission("integrations:write"),
  async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ success: false, code: "invalid_configuration", message: "A valid JSON configuration is required." }, 400);
    }
    return respond(c, async (service, tenantId) => service.configure(tenantId, input));
  },
);

routes.get(
  "/:integrationId",
  requireTenantClientPermission("integrations:read"),
  (c) => respond(c, async (service, tenantId) => ({
    connection: await service.inspect(tenantId, c.req.param("integrationId")),
  })),
);

routes.get(
  "/:integrationId/property",
  requireTenantClientPermission("integrations:read"),
  async (c) => {
    const principal = c.get("principal");
    if (!principal) return c.json({ success: false, message: "Unauthorized." }, 401);
    try {
      const result = await new STAAHMockSynchronizationService(c.env.DB)
        .property(principal.tenantId, c.req.param("integrationId"));
      return c.json({ success: true, ...result });
    } catch (error: unknown) {
      if (error instanceof STAAHManagementError || error instanceof STAAHSyncError) {
        return c.json({ success: false, code: error.code, message: error.message }, error.status);
      }
      console.error("STAAH mock property retrieval failed.", {
        operation: "tenant_scoped_mock_property",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return c.json({ success: false, code: "sync_failed", message: "STAAH mock property is temporarily unavailable." }, 503);
    }
  },
);

/**
 * M6.3C — Development-only synthetic booking submission.
 *
 * Not registered in the default production STAAH routes.
 * No live STAAH calls, inventory deductions, or GHL events.
 */
if (dependencies.submitMockBooking) {
  routes.post(
    "/:integrationId/mock-booking",
    requireTenantClientPermission("integrations:write"),
    async (c) => {
      if (c.env.APP_ENVIRONMENT !== "development") {
        return c.json(
          { success: false, message: "Not Found" },
          404,
        );
      }

      const principal = c.get("principal");

      if (!principal) {
        return c.json(
          { success: false, message: "Unauthorized." },
          401,
        );
      }

      let input: unknown;

      try {
        input = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            code: "invalid_booking_request",
            message: "Valid JSON is required.",
          },
          400,
        );
      }

      try {
        const outcome =
          await dependencies.submitMockBooking!(
            principal.tenantId,
            c.req.param("integrationId"),
            input,
          );

        return c.json({
          success: true,
          mode: "mock",
          replayed: outcome.replayed,
          booking: outcome.result,
        });
      } catch (error: unknown) {
        if (
          error instanceof STAAHManagementError ||
          error instanceof STAAHMockBookingError
        ) {
          return c.json(
            {
              success: false,
              code: error.code,
              message: error.message,
            },
            error.status,
          );
        }

        console.error(
          "Synthetic STAAH booking submission failed.",
          {
            operation: "mock_booking_submission",
            errorName:
              error instanceof Error
                ? error.name
                : "UnknownError",
          },
        );

        return c.json(
          {
            success: false,
            code: "mock_booking_unavailable",
            message:
              "Synthetic booking submission is unavailable.",
          },
          503,
        );
      }
    },
  );
}

routes.post(
  "/:integrationId/sync",
  requireTenantClientPermission("integrations:write"),
  async (c) => {
    const principal = c.get("principal");
    if (!principal) return c.json({ success: false, message: "Unauthorized." }, 401);
    try {
      const service = dependencies.createSyncService
  ? dependencies.createSyncService(c.env.DB)
  : new STAAHMockSynchronizationService(c.env.DB);

const sync = await service.synchronize(
  principal.tenantId,
  c.req.param("integrationId"),
);

return c.json({ success: true, sync });
    } catch (error: unknown) {
      if (error instanceof STAAHManagementError || error instanceof STAAHSyncError) {
        return c.json({ success: false, code: error.code, message: error.message }, error.status);
      }
      console.error("STAAH mock synchronization failed.", {
        operation: "tenant_scoped_mock_reservation_sync",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return c.json({ success: false, code: "sync_failed", message: "STAAH mock synchronization is temporarily unavailable." }, 503);
    }
  },
);

routes.put(
  "/:integrationId",
  requireTenantClientPermission("integrations:write"),
  async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ success: false, code: "invalid_configuration", message: "A valid JSON configuration is required." }, 400);
    }
    return respond(c, async (service, tenantId) => ({
      connection: await service.update(tenantId, c.req.param("integrationId"), input),
    }));
  },
);

for (const operation of ["verify", "disable", "enable"] as const) {
  routes.post(
    `/:integrationId/${operation}`,
    requireTenantClientPermission("integrations:write"),
    (c) => respond(c, async (service, tenantId) => ({
      connection: await service[operation](tenantId, c.req.param("integrationId")),
    })),
  );
}

  return routes;
}

export default createSTAAHRoutes();
