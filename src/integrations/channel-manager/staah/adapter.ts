import {
  STAAHAdapterError,
  type STAAHAdapter,
  type STAAHAdapterConfiguration,
  type STAAHCapabilities,
  type STAAHConnectionContext,
  type STAAHErrorClassification,
  type STAAHMockFailureScenario,
  type STAAHMockProperty,
  type STAAHMockReservation,
  type STAAHMockReservationBatch,
  type STAAHProviderRegistration,
  type STAAHVerificationResult,
  type STAAHMockARIQuery,
  type STAAHMockARIBatch,
  type STAAHMockARIRecord,
} from "./contracts";

export const STAAH_PROVIDER_REGISTRATION = {
  provider: "staah",
  displayName: "STAAH",
  category: "channel_manager",
  initialMode: "mock",
  liveSupported: false,
  downstreamSynchronization: false,
} as const satisfies STAAHProviderRegistration;

const MOCK_CAPABILITIES = {
  mockConnectionVerification: true,
  liveConnectionVerification: false,
  propertyInformation: true,
  roomRateMapping: true,
  reservationRetrieval: true,
  downstreamSynchronization: false,
} as const satisfies STAAHCapabilities;

const MOCK_RESERVATIONS: readonly STAAHMockReservation[] = [
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-001",
    revision: 1,
    modifiedAt: "2030-01-02T10:00:00.000Z",
    status: "CONFIRMED",
    firstName: "Alex",
    lastName: "Mock",
    email: "alex.mock@example.invalid",
    checkIn: "2030-04-10",
    checkOut: "2030-04-13",
    providerRoomId: "mock-room-001",
    providerRatePlanId: "mock-rate-001",
    totalAmount: 360,
    currency: "USD",
  },
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-001",
    revision: 1,
    modifiedAt: "2030-01-02T10:00:00.000Z",
    status: "CONFIRMED",
    firstName: "Alex",
    lastName: "Mock",
    email: "alex.mock@example.invalid",
    checkIn: "2030-04-10",
    checkOut: "2030-04-13",
    providerRoomId: "mock-room-001",
    providerRatePlanId: "mock-rate-001",
    totalAmount: 360,
    currency: "USD",
  },
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-001",
    revision: 2,
    modifiedAt: "2030-01-03T10:00:00.000Z",
    status: "CONFIRMED",
    firstName: "Alex",
    lastName: "Mock",
    email: "alex.mock@example.invalid",
    checkIn: "2030-04-11",
    checkOut: "2030-04-14",
    providerRoomId: "mock-room-002",
    providerRatePlanId: "mock-rate-002",
    totalAmount: 450,
    currency: "USD",
  },
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-002",
    revision: 1,
    modifiedAt: "2030-01-02T11:00:00.000Z",
    status: "CONFIRMED",
    firstName: "Jamie",
    lastName: "Sample",
    email: "jamie.sample@example.invalid",
    checkIn: "2030-05-02",
    checkOut: "2030-05-04",
    providerRoomId: "mock-room-002",
    providerRatePlanId: "mock-rate-001",
    totalAmount: 300,
    currency: "USD",
  },
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-002",
    revision: 2,
    modifiedAt: "2030-01-04T11:00:00.000Z",
    status: "CANCELLED",
    firstName: "Jamie",
    lastName: "Sample",
    email: "jamie.sample@example.invalid",
    checkIn: "2030-05-02",
    checkOut: "2030-05-04",
    providerRoomId: "mock-room-002",
    providerRatePlanId: "mock-rate-001",
    totalAmount: 300,
    currency: "USD",
  },
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-003",
    revision: 3,
    modifiedAt: "2030-01-05T12:00:00.000Z",
    status: "CONFIRMED",
    firstName: "Morgan",
    lastName: "Test",
    email: "morgan.test@example.invalid",
    checkIn: "2030-06-01",
    checkOut: "2030-06-03",
    providerRoomId: "mock-room-001",
    providerRatePlanId: "mock-rate-002",
    totalAmount: 280,
    currency: "USD",
  },
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-003",
    revision: 2,
    modifiedAt: "2030-01-04T12:00:00.000Z",
    status: "CONFIRMED",
    firstName: "Morgan",
    lastName: "Test",
    email: "morgan.test@example.invalid",
    checkIn: "2030-05-30",
    checkOut: "2030-06-01",
    providerRoomId: "mock-room-001",
    providerRatePlanId: "mock-rate-002",
    totalAmount: 250,
    currency: "USD",
  },
  {
    providerPropertyId: "*",
    providerReservationId: "mock-res-invalid",
    revision: 1,
    modifiedAt: "2030-01-06T12:00:00.000Z",
    status: "CONFIRMED",
    firstName: "Invalid",
    lastName: "Fixture",
    checkIn: "2030-06-10",
    checkOut: "2030-06-09",
    providerRoomId: "unknown-room",
    providerRatePlanId: "mock-rate-001",
    totalAmount: 100,
    currency: "USD",
  },
];

const SUPPORTED_PROFILES = new Set([
  "crm",
  "channelconnect_v2",
  "rms",
  "metachannel",
]);

function validateContext(
  context: STAAHConnectionContext,
): STAAHConnectionContext {
  if (
    !context ||
    !context.tenantId?.trim() ||
    !context.integrationId?.trim() ||
    !context.connectionId?.trim()
  ) {
    throw new STAAHAdapterError(
      "invalid_configuration",
      "STAAH tenant, integration, and connection identifiers are required.",
    );
  }

  return {
    tenantId: context.tenantId.trim(),
    integrationId: context.integrationId.trim(),
    connectionId: context.connectionId.trim(),
  };
}

const ARI_DAY_MS = 86_400_000;
const MAX_ARI_DAYS = 31;

function parseARIDate(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  const timestamp = date.getTime();

  if (
    !Number.isFinite(timestamp) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return timestamp;
}

function validateARIQuery(
  query: STAAHMockARIQuery,
): { start: number; days: number } {
  const start = parseARIDate(query?.startDate);
  const end = parseARIDate(query?.endDate);

  if (start === null || end === null || end < start) {
    throw new STAAHAdapterError(
      "invalid_configuration",
      "A valid synthetic ARI date range is required.",
    );
  }

  const days = Math.round((end - start) / ARI_DAY_MS) + 1;

  if (days < 1 || days > MAX_ARI_DAYS) {
    throw new STAAHAdapterError(
      "invalid_configuration",
      "Synthetic ARI supports a maximum of 31 inclusive calendar days.",
    );
  }

  return { start, days };
}

class STAAHMockAdapter implements STAAHAdapter {
  readonly provider = "staah" as const;
  readonly mode = "mock" as const;
  readonly profile = "crm" as const;
  readonly capabilities = MOCK_CAPABILITIES;



  constructor(
    private readonly boundContext: STAAHConnectionContext,
    private readonly simulateVerificationFailure: boolean,
    private readonly mockFailureScenario: STAAHMockFailureScenario,
  ) {}

  private assertContext(context: STAAHConnectionContext): void {
    const requestedContext = validateContext(context);
    if (
      requestedContext.tenantId !== this.boundContext.tenantId ||
      requestedContext.integrationId !== this.boundContext.integrationId ||
      requestedContext.connectionId !== this.boundContext.connectionId
    ) {
      throw new STAAHAdapterError(
        "connection_context_mismatch",
        "STAAH mock connection context does not match the initialized tenant connection.",
      );
    }
  }

  async verifyConnection(
    context: STAAHConnectionContext,
  ): Promise<STAAHVerificationResult> {
    this.assertContext(context);

    if (this.simulateVerificationFailure) {
      return {
        status: "mock_failed",
        provider: this.provider,
        mode: this.mode,
        profile: this.profile,
        connectionId: this.boundContext.connectionId,
        capabilities: this.capabilities,
        reason: "simulated_provider_failure",
      };
    }

    return {
      status: "mock_verified",
      provider: this.provider,
      mode: this.mode,
      profile: this.profile,
      connectionId: this.boundContext.connectionId,
      capabilities: this.capabilities,
    };
  }

  async getProperty(
    context: STAAHConnectionContext,
    providerPropertyId: string,
  ): Promise<STAAHMockProperty> {
    this.assertContext(context);
    validateMockPropertyId(providerPropertyId);
    return {
      providerPropertyId,
      name: "Synthetic Mock Property",
      timezone: "UTC",
      address: "100 Example Road, Mock City",
      rooms: [
        { providerRoomId: "mock-room-001", name: "Standard Room", capacity: 2 },
        { providerRoomId: "mock-room-002", name: "Family Room", capacity: 4 },
      ],
      ratePlans: [
        { providerRatePlanId: "mock-rate-001", name: "Flexible Mock Rate", currency: "USD" },
        { providerRatePlanId: "mock-rate-002", name: "Advance Mock Rate", currency: "USD" },
      ],
    };
  }

  async getReservations(
    context: STAAHConnectionContext,
    providerPropertyId: string,
  ): Promise<STAAHMockReservationBatch> {
    this.assertContext(context);
    validateMockPropertyId(providerPropertyId);
    if (this.mockFailureScenario === "provider_unavailable") {
      throw new STAAHAdapterError("mock_provider_unavailable", "Synthetic provider unavailable.");
    }
    if (this.mockFailureScenario === "timeout") {
      throw new STAAHAdapterError("mock_timeout", "Synthetic provider timeout.");
    }
    return {
      reservations: MOCK_RESERVATIONS.map((reservation) => ({
        ...reservation,
        providerPropertyId,
      })),
      ...(this.mockFailureScenario === "partial_batch_failure"
        ? { failAfterReservations: 2 }
        : {}),
    };
  }

    async getARI(
    context: STAAHConnectionContext,
    providerPropertyId: string,
    query: STAAHMockARIQuery,
  ): Promise<STAAHMockARIBatch> {
    this.assertContext(context);
    validateMockPropertyId(providerPropertyId);

    const { start, days } = validateARIQuery(query);

    if (this.mockFailureScenario === "provider_unavailable") {
      throw new STAAHAdapterError(
        "mock_provider_unavailable",
        "Synthetic ARI provider unavailable.",
      );
    }

    if (this.mockFailureScenario === "timeout") {
      throw new STAAHAdapterError(
        "mock_timeout",
        "Synthetic ARI provider timeout.",
      );
    }

    const property = await this.getProperty(
      context,
      providerPropertyId,
    );

    const records: STAAHMockARIRecord[] = [];

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const timestamp = start + dayOffset * ARI_DAY_MS;

      const date = new Date(timestamp)
        .toISOString()
        .slice(0, 10);

      const dayNumber = Math.floor(timestamp / ARI_DAY_MS);

      for (const room of property.rooms) {
        const totalRooms =
          room.providerRoomId === "mock-room-001" ? 8 : 4;

        // Deterministic daily occupancy, including
        // occasional sold-out dates.
        const occupiedRooms =
          dayNumber % (totalRooms + 1);

        const availableRooms =
          totalRooms - occupiedRooms;

        for (const ratePlan of property.ratePlans) {
          const baseRateMinor =
            room.providerRoomId === "mock-room-001"
              ? 12000
              : 18000;

          const rateAmountMinor =
            ratePlan.providerRatePlanId === "mock-rate-002"
              ? baseRateMinor - 1500
              : baseRateMinor;

          records.push({
            date,
            providerPropertyId,
            providerRoomId: room.providerRoomId,
            providerRatePlanId:
              ratePlan.providerRatePlanId,
            currency: ratePlan.currency,
            totalRooms,
            availableRooms,
            rateAmountMinor,
            sellable: availableRooms > 0,
          });
        }
      }
    }

    return {
      providerPropertyId,
      startDate: query.startDate,
      endDate: query.endDate,
      mode: "mock",
      records,
    };
  }


  classifyError(error: unknown): STAAHErrorClassification {
    if (!(error instanceof STAAHAdapterError)) {
      return { category: "unknown", retryable: false };
    }

    if (error.code === "invalid_configuration") {
      return { category: "configuration", retryable: false };
    }

    if (error.code === "mock_provider_unavailable") {
      return { category: "provider_unavailable", retryable: true };
    }
    if (error.code === "mock_timeout") {
      return { category: "timeout", retryable: true };
    }
    if (error.code === "mock_partial_batch_failure") {
      return { category: "partial_processing", retryable: true };
    }

    return { category: "unsupported", retryable: false };
  }
}

function validateMockPropertyId(providerPropertyId: string): void {
  if (!/^mock-[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(providerPropertyId)) {
    throw new STAAHAdapterError("invalid_configuration", "A synthetic property identifier is required.");
  }
}

/**
 * Resolve an explicitly scoped STAAH adapter. Mock is the default and needs no
 * provider credentials. Live mode and non-CRM profiles fail closed until a
 * profile-specific implementation is separately approved.
 */
export function resolveSTAAHAdapter(
  context: STAAHConnectionContext,
  configuration: STAAHAdapterConfiguration = {},
): STAAHAdapter {
  const boundContext = validateContext(context);

  if (
    configuration.mode !== undefined &&
    configuration.mode !== "mock" &&
    configuration.mode !== "live"
  ) {
    throw new STAAHAdapterError(
      "invalid_configuration",
      "STAAH mode must be mock or live.",
    );
  }

  const mode = configuration.mode ?? "mock";
  if (mode === "live") {
    throw new STAAHAdapterError(
      "live_mode_not_supported",
      "STAAH live mode is unavailable until a live provider implementation is approved.",
    );
  }

  const profile = configuration.profile ?? "crm";
  if (typeof profile !== "string" || !SUPPORTED_PROFILES.has(profile)) {
    throw new STAAHAdapterError(
      "invalid_configuration",
      "STAAH API profile is invalid.",
    );
  }

  if (profile !== "crm") {
    throw new STAAHAdapterError(
      "unsupported_api_profile",
      `STAAH profile ${profile} is not implemented in this milestone.`,
    );
  }

  if (
    configuration.simulateVerificationFailure !== undefined &&
    typeof configuration.simulateVerificationFailure !== "boolean"
  ) {
    throw new STAAHAdapterError(
      "invalid_configuration",
      "STAAH simulated verification failure flag must be boolean.",
    );
  }

  const mockFailureScenario = configuration.mockFailureScenario ?? "none";
  if (![
    "none",
    "provider_unavailable",
    "timeout",
    "partial_batch_failure",
  ].includes(String(mockFailureScenario))) {
    throw new STAAHAdapterError(
      "invalid_configuration",
      "STAAH mock failure scenario is invalid.",
    );
  }

  return new STAAHMockAdapter(
    boundContext,
    configuration.simulateVerificationFailure === true,
    mockFailureScenario as STAAHMockFailureScenario,
  );
}
