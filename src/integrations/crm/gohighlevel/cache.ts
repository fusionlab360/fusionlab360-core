import type { GHLMetadata } from "./metadata";

const cache = new Map<string, GHLMetadata>();

export function getMetadata(locationId: string) {
  return cache.get(locationId);
}

export function setMetadata(
  locationId: string,
  metadata: GHLMetadata
) {
  cache.set(locationId, metadata);
}

export function clearMetadata(locationId?: string) {
  if (locationId) {
    cache.delete(locationId);
    return;
  }

  cache.clear();
}