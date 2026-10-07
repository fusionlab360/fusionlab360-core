export function createEventId(): string {
  return crypto.randomUUID();
}