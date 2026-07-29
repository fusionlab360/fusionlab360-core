import type { RequestContext } from "../../context";
import type { AttributeMapping } from "../../persistence/models/integration-configuration";

export function resolveFieldMapping(
  context: RequestContext,
  canonicalField: string
): AttributeMapping {

  const mappings =
    context.tenant.integrations.crm.configuration.attributeMappings;

  const mapping = mappings.find(
    (mapping) => mapping.canonicalKey === canonicalField
  );

  if (!mapping) {
    throw new Error(
      `Missing field mapping for canonical field '${canonicalField}'.`
    );
  }

  return mapping;
}