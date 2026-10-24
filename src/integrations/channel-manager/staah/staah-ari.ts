import {
  resolveSTAAHAdapter,
  STAAHAdapterError,
} from "./";

import type {
  STAAHMockARIQuery,
  STAAHMockARIBatch,
} from "./contracts";

import {
  STAAHConnectionManagementService,
} from "./staah-management";

export class STAAHARIError extends Error {
  constructor(
    readonly status: 400 | 503,
    readonly code:
      | "invalid_date_range"
      | "provider_unavailable"
      | "provider_timeout"
      | "invalid_provider_data",
    message: string,
  ) {
    super(message);
    this.name = "STAAHARIError";
  }
}

/**
 * Read-only, tenant-scoped synthetic STAAH ARI retrieval.
 *
 * This service:
 * - uses the existing tenant-owned STAAH connection
 * - requires an enabled and verified connection
 * - never accesses real STAAH APIs
 * - never writes inventory or pricing to D1
 * - never triggers reservation or GHL synchronization
 */
export class STAAHMockARIService {
  constructor(
    private readonly management: STAAHConnectionManagementService,
  ) {}

  async retrieve(
    tenantId: string,
    integrationId: string,
    query: STAAHMockARIQuery,
  ): Promise<STAAHMockARIBatch> {
    // Ownership, enabled status and verification are enforced
    // by the existing connection management service.
    const connection =
      await this.management.loadOperationalConnection(
        tenantId,
        integrationId,
      );

    const adapter = resolveSTAAHAdapter(
      connection.context,
      {
        mode: "mock",
        profile: "crm",
        mockFailureScenario: connection.mockFailureScenario,
      },
    );

    let result: STAAHMockARIBatch;

    try {
      result = await adapter.getARI(
        connection.context,
        connection.syntheticPropertyId,
        query,
      );
    } catch (error: unknown) {
      if (error instanceof STAAHAdapterError) {
        if (error.code === "invalid_configuration") {
          throw new STAAHARIError(
            400,
            "invalid_date_range",
            "A valid synthetic ARI date range of up to 31 days is required.",
          );
        }

        if (error.code === "mock_provider_unavailable") {
          throw new STAAHARIError(
            503,
            "provider_unavailable",
            "Synthetic ARI provider is temporarily unavailable.",
          );
        }

        if (error.code === "mock_timeout") {
          throw new STAAHARIError(
            503,
            "provider_timeout",
            "Synthetic ARI provider timed out.",
          );
        }
      }

      throw new STAAHARIError(
        503,
        "invalid_provider_data",
        "Synthetic ARI retrieval failed.",
      );
    }

    // Fail closed if the adapter returns a different property.
    if (
      result.providerPropertyId !==
        connection.syntheticPropertyId ||
      result.mode !== "mock" ||
      result.startDate !== query.startDate ||
      result.endDate !== query.endDate ||
      !Array.isArray(result.records)
    ) {
      throw new STAAHARIError(
        503,
        "invalid_provider_data",
        "Synthetic ARI response failed validation.",
      );
    }

    const property = await adapter.getProperty(
      connection.context,
      connection.syntheticPropertyId,
    );

    const rooms = new Set(
      property.rooms.map((room) => room.providerRoomId),
    );

    const ratePlans = new Map(
      property.ratePlans.map((ratePlan) => [
        ratePlan.providerRatePlanId,
        ratePlan.currency,
      ]),
    );

    const uniqueRecords = new Set<string>();

    for (const record of result.records) {
      const key = [
        record.date,
        record.providerRoomId,
        record.providerRatePlanId,
      ].join("|");

      const valid =
        record.providerPropertyId ===
          connection.syntheticPropertyId &&
        record.date >= query.startDate &&
        record.date <= query.endDate &&
        rooms.has(record.providerRoomId) &&
        ratePlans.get(record.providerRatePlanId) ===
          record.currency &&
        Number.isSafeInteger(record.totalRooms) &&
        record.totalRooms >= 0 &&
        Number.isSafeInteger(record.availableRooms) &&
        record.availableRooms >= 0 &&
        record.availableRooms <= record.totalRooms &&
        Number.isSafeInteger(record.rateAmountMinor) &&
        record.rateAmountMinor >= 0 &&
        record.sellable === (record.availableRooms > 0) &&
        !uniqueRecords.has(key);

      if (!valid) {
        throw new STAAHARIError(
          503,
          "invalid_provider_data",
          "Synthetic ARI records failed validation.",
        );
      }

      uniqueRecords.add(key);
    }

    return result;
  }
}