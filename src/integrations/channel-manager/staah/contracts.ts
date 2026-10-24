/**
 * STAAH API products use separate contracts and credentials. Keep the selected
 * profile explicit so future provider work cannot silently mix their formats.
 */
export type STAAHApiProfile =
  | "crm"
  | "channelconnect_v2"
  | "rms"
  | "metachannel";

export type STAAHProviderMode = "mock" | "live";

/** Values must originate from the trusted tenant/integration resolution path. */
export interface STAAHConnectionContext {
  tenantId: string;
  integrationId: string;
  connectionId: string;
}

export interface STAAHProviderRegistration {
  provider: "staah";
  displayName: "STAAH";
  category: "channel_manager";
  initialMode: "mock";
  liveSupported: false;
  downstreamSynchronization: false;
}

export interface STAAHCapabilities {
  mockConnectionVerification: true;
  liveConnectionVerification: false;
  propertyInformation: true;
  roomRateMapping: true;
  reservationRetrieval: true;
  downstreamSynchronization: false;
}

export type STAAHMockFailureScenario =
  | "none"
  | "provider_unavailable"
  | "timeout"
  | "partial_batch_failure";

export interface STAAHMockProperty {
  providerPropertyId: string;
  name: string;
  timezone: string;
  address: string;
  rooms: readonly STAAHMockRoom[];
  ratePlans: readonly STAAHMockRatePlan[];
}

export interface STAAHMockRoom {
  providerRoomId: string;
  name: string;
  capacity: number;
}

export interface STAAHMockRatePlan {
  providerRatePlanId: string;
  name: string;
  currency: string;
}

/**
 * Synthetic ARI query.
 *
 * Dates are inclusive, YYYY-MM-DD, with a maximum
 * range of 31 calendar days.
 *
 * Not an official STAAH API contract.
 */
export interface STAAHMockARIQuery {
  startDate: string;
  endDate: string;
}

/**
 * One daily room/rate-plan combination.
 *
 * All monetary amounts use minor currency units
 * (for example, USD 120.00 = 12000 cents).
 */
export interface STAAHMockARIRecord {
  date: string;
  providerPropertyId: string;
  providerRoomId: string;
  providerRatePlanId: string;
  currency: string;
  totalRooms: number;
  availableRooms: number;
  rateAmountMinor: number;
  sellable: boolean;
}

export interface STAAHMockARIBatch {
  providerPropertyId: string;
  startDate: string;
  endDate: string;
  mode: "mock";
  records: readonly STAAHMockARIRecord[];
}

/** Internal deterministic fixture contract; this is not an official STAAH payload. */
export interface STAAHMockReservation {
  providerPropertyId: string;
  providerReservationId: string;
  revision: number;
  modifiedAt: string;
  status: "CONFIRMED" | "CANCELLED";
  firstName: string;
  lastName: string;
  email?: string;
  checkIn: string;
  checkOut: string;
  providerRoomId: string;
  providerRatePlanId: string;
  totalAmount: number;
  currency: string;
}

export interface STAAHResourceMapping {
  tenantId: string;
  integrationId: string;
  provider: "staah";
  providerPropertyId: string;
  resourceType: "property" | "room" | "rate_plan";
  providerResourceId: string;
  canonicalResourceId: string;
}

export interface STAAHMockReservationBatch {
  reservations: readonly STAAHMockReservation[];
  /** Deterministic fixture hook used to verify partial-progress recovery. */
  failAfterReservations?: number;
}

export interface STAAHVerificationResult {
  status: "mock_verified" | "mock_failed";
  provider: "staah";
  mode: "mock";
  profile: "crm";
  connectionId: string;
  capabilities: STAAHCapabilities;
  reason?: "simulated_provider_failure";
}

export type STAAHErrorCategory =
  | "configuration"
  | "unsupported"
  | "provider_unavailable"
  | "timeout"
  | "partial_processing"
  | "unknown";

export interface STAAHErrorClassification {
  category: STAAHErrorCategory;
  retryable: boolean;
}

export type STAAHAdapterErrorCode =
  | "invalid_configuration"
  | "unsupported_api_profile"
  | "live_mode_not_supported"
  | "connection_context_mismatch"
  | "mock_provider_unavailable"
  | "mock_timeout"
  | "mock_partial_batch_failure";

export class STAAHAdapterError extends Error {
  constructor(
    readonly code: STAAHAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "STAAHAdapterError";
  }
}

export interface STAAHAdapter {
  readonly provider: "staah";
  readonly mode: "mock";
  readonly profile: "crm";
  readonly capabilities: STAAHCapabilities;

  verifyConnection(
    context: STAAHConnectionContext,
  ): Promise<STAAHVerificationResult>;

  getProperty(
    context: STAAHConnectionContext,
    providerPropertyId: string,
  ): Promise<STAAHMockProperty>;

  getReservations(
    context: STAAHConnectionContext,
    providerPropertyId: string,
  ): Promise<STAAHMockReservationBatch>;

  getARI(
    context: STAAHConnectionContext,
    providerPropertyId: string,
    query: STAAHMockARIQuery,
  ): Promise<STAAHMockARIBatch>;

  classifyError(error: unknown): STAAHErrorClassification;
}

/** Runtime input is unknown because settings may come from persisted JSON. */
export interface STAAHAdapterConfiguration {
  mode?: unknown;
  profile?: unknown;
  simulateVerificationFailure?: unknown;
  mockFailureScenario?: unknown;
}
