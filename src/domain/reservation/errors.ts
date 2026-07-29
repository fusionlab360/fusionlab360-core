export class ReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationError";
  }
}

export class ContactSyncFailedError extends ReservationError {
  constructor(
    message = "Failed to obtain GoHighLevel Contact ID."
  ) {
    super(message);
    this.name = "ContactSyncFailedError";
  }
}

export class OpportunitySyncFailedError extends ReservationError {
  constructor(
    message = "Failed to synchronize GoHighLevel Opportunity."
  ) {
    super(message);
    this.name = "OpportunitySyncFailedError";
  }
}