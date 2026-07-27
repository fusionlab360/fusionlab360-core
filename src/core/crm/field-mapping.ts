import type { RequestContext } from "../../context";
import type { ProviderFieldMapping } from "../../canonical/types";

export function resolveFieldMapping(
  context: RequestContext,
  canonicalField: string
): ProviderFieldMapping {

  const mappings =
    context.tenant.integrations.crm.configuration.fieldMappings;

  const mapping = mappings[canonicalField];

  if (!mapping) {
    throw new Error(`Missing field mapping: ${canonicalField}`);
  }

  return mapping;
}