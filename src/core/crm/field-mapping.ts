import type { RequestContext } from "../../context";
import type {
  AttributeMapping,
  IntegrationConfiguration,
} from "../../persistence/models/integration-configuration";

function getConfiguration(
  context: RequestContext,
): IntegrationConfiguration {

  const configuration =
    context.tenant.integrations.crm.configuration;

  if (!configuration) {
    throw new Error(
      "CRM integration has not been configured.",
    );
  }

  return configuration;
}

function getMappings(
  context: RequestContext,
): AttributeMapping[] {

  return getConfiguration(
    context,
  ).attributeMappings;
}

/**
 * Required mapping.
 * Throws if the mapping does not exist.
 */
export function resolveFieldMapping(
  context: RequestContext,
  canonicalField: string,
): AttributeMapping {

  const mapping =
    getMappings(context).find(
      (mapping) =>
        mapping.canonicalKey === canonicalField,
    );

  if (!mapping) {
    throw new Error(
      `Missing required field mapping for canonical field '${canonicalField}'.`,
    );
  }

  return mapping;
}

/**
 * Optional mapping.
 * Returns undefined when the field is not mapped.
 */
export function tryResolveFieldMapping(
  context: RequestContext,
  canonicalField: string,
): AttributeMapping | undefined {

  return getMappings(
    context,
  ).find(
    (mapping) =>
      mapping.canonicalKey === canonicalField,
  );
}