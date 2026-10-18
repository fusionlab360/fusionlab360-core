import type {
  CRMOnboarding,
  CRMPreviewResult,
} from "../../../core/crm/onboarding";

import type {
  IntegrationConfiguration,
} from "../../../persistence/models/integration-configuration";

import {
  resolveMetadata,
} from "./metadata";

import {
  discoverConfiguration,
} from "./discovery";

import {
  getGHLLLocation,
} from "./locations/get";

import {
  searchGHLUsers,
} from "./users/search";

import {
  discoverGHLEventConfiguration,
} from "./events/discovery";

import type { RequestContext } from "../../../context";


export const goHighLevelOnboarding: CRMOnboarding = {

  async preview(
    context: RequestContext,
  ): Promise<CRMPreviewResult> {
    const locationId =
      context.tenant.integrations.crm.credentials.locationId.trim();

    const metadata = await resolveMetadata(
      context,
      locationId,
    );

    return {
      provider: "gohighlevel",
      locationId,
      pipelines: metadata.pipelines,
      stages: metadata.stages.length,
      customFields: metadata.customFields.length,
    };
  },


  async configure(
  context: RequestContext,
  pipelineId: string,
  providerOptions?: Record<string, unknown>,
): Promise<IntegrationConfiguration> {

   const locationId =
    context.tenant.integrations.crm.credentials.locationId.trim();

    /*
     * --------------------------------------------------
     * 1. Resolve GHL metadata
     * --------------------------------------------------
     *
     * This remains completely provider-specific.
     * No tenant-specific values are hardcoded.
     */

     const metadata = await resolveMetadata(
        context,
        locationId,
      );


    /*
     * --------------------------------------------------
     * 2. Build the generic IPaaS configuration
     * --------------------------------------------------
     */

    const configuration =
      discoverConfiguration(
        metadata,
        pipelineId,
      );


    /*
     * --------------------------------------------------
     * 3. Resolve GHL location information
     * --------------------------------------------------
     */

    const locationResponse =
      await getGHLLLocation(
        context,
        locationId,
      );


    const companyId =
      locationResponse.location?.companyId;


    if (!companyId) {
      throw new Error(
        "GoHighLevel location returned no companyId.",
      );
    }


    /*
     * --------------------------------------------------
     * 4. Resolve the GHL user required by Notes
     * --------------------------------------------------
     *
     * userId is provider-specific configuration.
     * It must not become part of the generic
     * credential or canonical contact model.
     */

    const usersResponse =
      await searchGHLUsers(
        context,
        companyId,
        locationId,
      );


    const userId =
      usersResponse.users?.[0]?.id;


    if (!userId) {
      throw new Error(
        "No GoHighLevel user found for the configured location.",
      );
    }


    /*
     * --------------------------------------------------
     * 5. Read Contact Event configuration
     * --------------------------------------------------
     *
     * The selected event object and field identifiers
     * come from tenant/provider configuration.
     *
     * Nothing GHL-specific is hardcoded here.
     */

    const contactEventsOptions =
      providerOptions?.contactEvents;


    if (
      typeof contactEventsOptions !==
        "object" ||
      contactEventsOptions ===
        null
    ) {
      throw new Error(
        "GoHighLevel Contact Events configuration is required.",
      );
    }


    const contactEvents =
      contactEventsOptions as
        Record<
          string,
          unknown
        >;


    const eventSchemaKey =
      typeof contactEvents.schemaKey ===
        "string"
        ? contactEvents.schemaKey.trim()
        : "";


    const eventDateFieldKey =
      typeof contactEvents.dateFieldKey ===
        "string"
        ? contactEvents.dateFieldKey.trim()
        : "";


    const eventTypeFieldKey =
      typeof contactEvents.typeFieldKey ===
        "string"
        ? contactEvents.typeFieldKey.trim()
        : "";


    if (!eventSchemaKey) {
      throw new Error(
        "GoHighLevel Contact Events schemaKey is required.",
      );
    }


    if (!eventDateFieldKey) {
      throw new Error(
        "GoHighLevel Contact Events dateFieldKey is required.",
      );
    }


    if (!eventTypeFieldKey) {
      throw new Error(
        "GoHighLevel Contact Events typeFieldKey is required.",
      );
    }


    /*
     * --------------------------------------------------
     * 6. Dynamically discover the remaining GHL
     *    Contact Event configuration
     * --------------------------------------------------
     *
     * Discovery resolves:
     *
     * - associationId
     * - firstObjectKey
     * - secondObjectKey
     *
     * and validates the configured field keys
     * against the actual GHL object schema.
     */

    const eventConfiguration =
      await discoverGHLEventConfiguration(
        context,
        locationId,
        eventSchemaKey,
        eventDateFieldKey,
        eventTypeFieldKey,
      );


    /*
     * --------------------------------------------------
     * 7. Return the complete IPaaS configuration
     * --------------------------------------------------
     *
     * Generic configuration:
     *   workflow
     *   attributeMappings
     *
     * Provider-specific configuration:
     *   companyId
     *   userId
     *   contactEvents
     *
     * No tenant-specific GHL identifiers are compiled
     * into Core.
     */

    return {
      ...configuration,

      providerConfiguration: {

        companyId,

        userId,

        contactEvents:
          eventConfiguration,
      },
    };
  },
};