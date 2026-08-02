import { logger } from "../../../core/logger";

import type { GHLMetadata } from "./metadata";

const cache = new Map<string, GHLMetadata>();

export function getMetadata(
  locationId: string,
): GHLMetadata | undefined {
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

export function hasMetadata(
  locationId: string,
): boolean {
  return cache.has(locationId);
}

export function setMetadata(
  locationId: string,
  metadata: GHLMetadata,
): void {
  cache.set(locationId, metadata);

  logger.debug("Metadata cached", {
    locationId,
    pipelines: metadata.pipelines.length,
    stages: metadata.stages.length,
    customFields: metadata.customFields.length,
  });
}

export function clearMetadata(
  locationId?: string,
): void {
  if (locationId) {
    cache.delete(locationId);

    logger.debug("Metadata cache cleared", {
      locationId,
    });

    return;
  }

  cache.clear();

  logger.debug("All metadata cache cleared");
}