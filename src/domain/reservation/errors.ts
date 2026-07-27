export class ReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationError";
  }
}

export class ContactSyncFailedError extends ReservationError {
  constructor() {
    super("Failed to obtain GoHighLevel Contact ID.");
    this.name = "ContactSyncFailedError";
  }
}

export class OpportunitySyncFailedError extends ReservationError {
  constructor() {
    super("Failed to synchronize GoHighLevel Opportunity.");
    this.name = "OpportunitySyncFailedError";
  }
}