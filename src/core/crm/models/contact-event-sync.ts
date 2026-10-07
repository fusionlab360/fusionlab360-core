export interface ContactEventsSyncInput {
  contactId: string;

  events: Array<{
    date: string;
    type: string;
  }>;
}

export interface ContactEventsSyncResult {
  created: number;
  deleted: number;
  kept: number;
}