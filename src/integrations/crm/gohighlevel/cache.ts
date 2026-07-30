import { logger } from "../../../core/logger";

import type { GHLMetadata } from "./metadata";

const cache = new Map<string, GHLMetadata>();

export function getMetadata(locationId: string) {
  const metadata = cache.get(locationId);

  logger.debug(
    metadata
      ? "Metadata cache hit"
      : "Metadata cache miss",
    {
      locationId,
    },
  );

  return metadata;
}

export function setMetadata(
  locationId: string,
  metadata: GHLMetadata
) {
  cache.set(locationId, metadata);

  logger.debug("Metadata cached", {
    locationId,
  });
}

export function clearMetadata(locationId?: string) {
  if (locationId) {
    cache.delete(locationId);

    logger.debug("Metadata cache cleared", {
      locationId,
    });

    return;
  }

  cache.clear();

  logger.debug("Metadata cache cleared");
}