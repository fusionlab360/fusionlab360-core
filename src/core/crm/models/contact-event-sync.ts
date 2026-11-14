export interface ContactEventsSyncInput {
  contactId: string;
  managedOnly?: true;
  clearManaged?: true;

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