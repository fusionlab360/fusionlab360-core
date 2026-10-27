import type { Context } from "hono";

import type {
  ConfigureIntegrationRequest,
} from "./types";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  logger,
} from "../../core/logger";

import {
  onboardingService,
} from "../../application/onboarding";

import {
  discoverAndSaveConfiguration,
} from "./service";

import {
  getGHLCredentials,
} from "../../integrations/crm/gohighlevel/credentials";

import {
  listGHLObjects,
  getGHLObjectSchema,
  listGHLAssociations,
} from "../../integrations/crm/gohighlevel/events/discovery";

import {
  createRepositories,
} from "../../persistence/factory";

import {
  normalizeGHLRentalsBookingPageUrl,
} from "../booking/rentals-booking-page";

import {
  normalizeGHLConversationProviderId,
} from "../../integrations/messaging/gohighlevel/custom-conversation-provider";

/**
 * Discover the configured CRM integration.
 */
export async function discoverIntegrationController(
  c: Context<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>,
) {

  try {

    logger.info(
      "Integration discovery started",
    );


    const context =
      c.get(
        "context",
      );


    logger.debug(
      "Integration context loaded",
      {
        tenantId:
          context.tenant.id,

        integrationId:
          context.tenant.integrations.crm.id,
      },
    );


    const configuration =
      await discoverAndSaveConfiguration(
        c.env.DB,
        context,
      );


    logger.info(
      "Integration discovery completed",
      {
        workflow:
          configuration.workflow.key,

        attributeMappings:
          configuration.attributeMappings.length,
      },
    );


    return c.json(
      configuration,
    );

  } catch (
    error
  ) {

    logger.error(
      "Integration discovery failed",
      {
        error,
      },
    );


    return c.json(
      {
        success:
          false,

        message:
          error instanceof Error
            ? error.message
            : "Unknown error",

        stack:
          error instanceof Error
            ? error.stack
            : undefined,
      },
      500,
    );
  }
}


/**
 * Preview the current CRM provider metadata.
 */
export async function previewIntegrationController(
  c: Context<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>,
) {

  try {

    const context =
      c.get(
        "context",
      );


    const metadata =
      await onboardingService.preview(
        context,
      );


    return c.json({
      success:
        true,

      data:
        metadata,
    });

  } catch (
    error
  ) {

    logger.error(
      "Integration preview failed",
      {
        error,
      },
    );


    return c.json(
      {
        success:
          false,

        message:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      500,
    );
  }
}


/**
 * Configure the current CRM integration.
 *
 * Generic configuration is handled by the
 * onboarding service. Provider-specific options
 * are passed through without the generic Core
 * needing to understand them.
 */
export async function configureIntegrationController(
  c: Context<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>,
) {

  try {

    const context =
      c.get(
        "context",
      );


    const body =
      await c.req.json<
        ConfigureIntegrationRequest
      >();


    const result =
      await onboardingService.configure(
        c.env.DB,
        context,
        body.pipelineId,
        body.providerOptions,
      );


    return c.json({
      success:
        true,

      workflow:
        result.configuration.workflow,

      attributeMappings:
        result.configuration
          .attributeMappings.length,

      providerConfiguration:
        result.configuration
          .providerConfiguration,
    });

  } catch (
    error
  ) {

    logger.error(
      "Integration configuration failed",
      {
        error,
      },
    );


    return c.json(
      {
        success:
          false,

        message:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      500,
    );
  }
}


/**
 * Preview GoHighLevel Contact Event
 * objects, fields, and associations.
 *
 * This endpoint is provider-specific.
 *
 * It uses the GHL credential belonging to
 * the authenticated tenant and therefore never
 * accepts tenant IDs, location IDs, API keys,
 * schema IDs, field IDs, or association IDs
 * from the caller.
 *
 * Request:
 *
 * POST /integrations/gohighlevel/events/preview
 *
 * First request:
 *
 * {}
 *
 * Returns available GHL objects.
 *
 * Second request:
 *
 * {
 *   "schemaKey": "..."
 * }
 *
 * Returns the selected object's schema,
 * fields, and associations.
 */
export async function previewGHLContactEventsController(
  c: Context<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>,
) {

  try {

    const context =
      c.get(
        "context",
      );


    const credentials =
      getGHLCredentials(
        context,
      );


    let body:
      {
        schemaKey?: string;
      } = {};


    /*
     * The request body is optional.
     *
     * If the caller does not send valid JSON,
     * treat it as an empty request and return
     * the available GHL objects.
     */
    try {

      body =
        await c.req.json<{
          schemaKey?: string;
        }>();

    } catch {

      body = {};
    }


    /*
     * --------------------------------------------------
     * CASE 1
     * --------------------------------------------------
     *
     * No schemaKey supplied.
     *
     * Return the GHL objects available to the
     * authenticated tenant/location.
     */
    if (
      !body.schemaKey?.trim()
    ) {

      logger.info(
        "GHL Contact Event object discovery started",
        {
          tenantId:
            context.tenant.id,

          locationId:
            credentials.locationId,
        },
      );


      const objects =
        await listGHLObjects(
          context,
          credentials.locationId,
        );


      logger.info(
        "GHL Contact Event object discovery completed",
        {
          tenantId:
            context.tenant.id,

          locationId:
            credentials.locationId,

          objectCount:
            objects.length,
        },
      );


      return c.json({
        success:
          true,

        provider:
          "gohighlevel",

        locationId:
          credentials.locationId,

        objects:
          objects.map(
            (
              object,
            ) => ({
              id:
                object.id,

              key:
                object.key,

              standard:
                object.standard ??
                false,

              labels:
                object.labels ??
                null,

              locationId:
                object.locationId ??
                credentials.locationId,
            }),
          ),
      });
    }


    /*
     * --------------------------------------------------
     * CASE 2
     * --------------------------------------------------
     *
     * schemaKey supplied.
     *
     * Return:
     *
     * - object schema
     * - fields
     * - associations
     */
    const schemaKey =
      body.schemaKey.trim();


    logger.info(
      "GHL Contact Event object schema discovery started",
      {
        tenantId:
          context.tenant.id,

        locationId:
          credentials.locationId,

        schemaKey,
      },
    );


    const [
      schema,
      associations,
    ] =
      await Promise.all([
        getGHLObjectSchema(
          context,
          credentials.locationId,
          schemaKey,
        ),

        listGHLAssociations(
          context,
          credentials.locationId,
        ),
      ]);


    /*
     * Only associations involving the selected
     * object are returned.
     */
    const objectAssociations =
      associations.filter(
        (
          association,
        ) =>
          association.firstObjectKey ===
            schemaKey ||
          association.secondObjectKey ===
            schemaKey,
      );


    logger.info(
      "GHL Contact Event object schema discovery completed",
      {
        tenantId:
          context.tenant.id,

        locationId:
          credentials.locationId,

        schemaKey,

        fieldCount:
          schema.fields.length,

        associationCount:
          objectAssociations.length,
      },
    );


    return c.json({
      success:
        true,

      provider:
        "gohighlevel",

      locationId:
        credentials.locationId,

      object: {
        id:
          schema.object.id,

        key:
          schema.object.key,

        labels:
          schema.object.labels ??
          null,

        primaryDisplayProperty:
          schema.object
            .primaryDisplayProperty ??
          null,
      },

      fields:
        schema.fields.map(
          (
            field,
          ) => ({
            id:
              field.id,

            fieldKey:
              field.fieldKey,

            name:
              field.name,

            dataType:
              field.dataType,

            objectKey:
              field.objectKey,
          }),
        ),

      associations:
        objectAssociations.map(
          (
            association,
          ) => ({
            id:
              association.id,

            key:
              association.key,

            firstObjectKey:
              association.firstObjectKey,

            secondObjectKey:
              association.secondObjectKey,

            firstObjectLabel:
              association.firstObjectLabel ??
              null,

            secondObjectLabel:
              association.secondObjectLabel ??
              null,

            associationType:
              association.associationType ??
              null,

            locationId:
              association.locationId,
          }),
        ),
    });

  } catch (
    error: unknown
  ) {

    logger.error(
      "GHL Contact Events preview failed",
      {
        error,
      },
    );


    return c.json(
      {
        success:
          false,

        message:
          error instanceof Error
            ? error.message
            : "GHL Contact Events preview failed.",
      },
      500,
    );
  }
}

type GHLRentalsBookingPageContext = Context<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>;

type GHLCustomConversationProviderContext = Context<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>;

/**
 * Accept only public HTTPS booking-page URLs.
 * Custom domains and HighLevel-hosted booking URLs are supported.
 */


/**
 * Get the Rentals booking-page URL for the
 * currently authenticated tenant.
 */
export async function getGHLRentalsBookingPageController(
  c: GHLRentalsBookingPageContext,
) {
  const requestContext = c.get("context");
  const crm = requestContext.tenant.integrations.crm;

  if (crm.provider !== "gohighlevel") {
    return c.json(
      {
        success: false,
        message:
          "Rentals booking-page configuration requires a GoHighLevel integration.",
      },
      409,
    );
  }

  try {
    const { configurationRepository } =
      createRepositories(c.env.DB);

    const configuration =
      await configurationRepository.getByIntegrationId(
        crm.id,
      );

    const bookingUrl =
      normalizeGHLRentalsBookingPageUrl(
        configuration
          ?.providerConfiguration
          ?.rentalsBookingUrl,
      );

    return c.json({
      success: true,
      bookingUrl,
    });
  } catch (error: unknown) {
    logger.error(
      "Failed to load GHL Rentals booking-page configuration.",
      {
        tenantId: requestContext.tenant.id,
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      },
    );

    return c.json(
      {
        success: false,
        message:
          "Unable to load Rentals booking-page configuration.",
      },
      500,
    );
  }
}

/**
 * Set or clear the Rentals booking-page URL
 * for the currently authenticated tenant.
 *
 * Set:
 *   { "bookingUrl": "https://example.com/rentals/your-slug" }
 *
 * Clear:
 *   { "bookingUrl": null }
 */
export async function updateGHLRentalsBookingPageController(
  c: GHLRentalsBookingPageContext,
) {
  const requestContext = c.get("context");
  const crm = requestContext.tenant.integrations.crm;

  if (crm.provider !== "gohighlevel") {
    return c.json(
      {
        success: false,
        message:
          "Rentals booking-page configuration requires a GoHighLevel integration.",
      },
      409,
    );
  }

  let body: unknown;

  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json(
      {
        success: false,
        message: "Invalid JSON body.",
      },
      400,
    );
  }

  if (
    body === null ||
    typeof body !== "object" ||
    !("bookingUrl" in body)
  ) {
    return c.json(
      {
        success: false,
        message:
          "bookingUrl is required and must be an HTTPS URL or null.",
      },
      400,
    );
  }

  const requestedUrl =
    (body as { bookingUrl: unknown }).bookingUrl;

  let bookingUrl: string | null;

  if (requestedUrl === null) {
    bookingUrl = null;
  } else {
    bookingUrl =
      normalizeGHLRentalsBookingPageUrl(
        requestedUrl,
      );

    if (!bookingUrl) {
      return c.json(
        {
          success: false,
          message:
            "bookingUrl must be a valid public HTTPS URL without embedded credentials.",
        },
        400,
      );
    }
  }

  try {
    const { configurationRepository } =
      createRepositories(c.env.DB);

    const integrationId = crm.id;

    const configuration =
      await configurationRepository.getByIntegrationId(
        integrationId,
      );

    if (!configuration) {
      return c.json(
        {
          success: false,
          message:
            "Configure the tenant's CRM integration before setting its Rentals booking page.",
        },
        409,
      );
    }

    const providerConfiguration = {
      ...(configuration.providerConfiguration ?? {}),
    };

    if (bookingUrl === null) {
      delete providerConfiguration.rentalsBookingUrl;
    } else {
      providerConfiguration.rentalsBookingUrl =
        bookingUrl;
    }

    await configurationRepository.save(
      integrationId,
      {
        ...configuration,
        providerConfiguration,
      },
    );

    logger.info(
      "GHL Rentals booking-page configuration updated.",
      {
        tenantId: requestContext.tenant.id,
        configured: bookingUrl !== null,
      },
    );

    return c.json({
      success: true,
      bookingUrl,
    });
  } catch (error: unknown) {
    logger.error(
      "Failed to update GHL Rentals booking-page configuration.",
      {
        tenantId: requestContext.tenant.id,
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      },
    );

    return c.json(
      {
        success: false,
        message:
          "Unable to update Rentals booking-page configuration.",
      },
      500,
    );
  }
}

/**
 * Return the current tenant's configured HighLevel Custom Conversation
 * Provider identifier. It is provider configuration, never a credential.
 */
export async function getGHLCustomConversationProviderController(
  c: GHLCustomConversationProviderContext,
) {
  const requestContext = c.get("context");
  const crm = requestContext.tenant.integrations.crm;

  if (crm.provider !== "gohighlevel") {
    return c.json({
      success: false,
      message: "Custom Conversation Provider configuration requires a GoHighLevel integration.",
    }, 409);
  }

  try {
    const { configurationRepository } = createRepositories(c.env.DB);
    const configuration = await configurationRepository.getByIntegrationId(crm.id);
    const conversationProviderId = normalizeGHLConversationProviderId(
      configuration?.providerConfiguration?.conversationProviderId,
    );

    return c.json({
      success: true,
      conversationProviderId,
    });
  } catch (error: unknown) {
    logger.error("Failed to load GHL Custom Conversation Provider configuration.", {
      tenantId: requestContext.tenant.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return c.json({
      success: false,
      message: "Unable to load Custom Conversation Provider configuration.",
    }, 500);
  }
}

/**
 * Set the Custom Conversation Provider ID for the authenticated tenant's
 * existing GHL integration. The route accepts no tenant, location, or
 * arbitrary settings object: all ownership is resolved from request context.
 */
export async function updateGHLCustomConversationProviderController(
  c: GHLCustomConversationProviderContext,
) {
  const requestContext = c.get("context");
  const crm = requestContext.tenant.integrations.crm;

  if (crm.provider !== "gohighlevel") {
    return c.json({
      success: false,
      message: "Custom Conversation Provider configuration requires a GoHighLevel integration.",
    }, 409);
  }

  if (!crm.credentials.locationId.trim()) {
    return c.json({
      success: false,
      message: "The authenticated tenant has no configured GoHighLevel location.",
    }, 409);
  }

  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json({ success: false, message: "Invalid JSON body." }, 400);
  }

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("conversationProviderId" in body)
  ) {
    return c.json({
      success: false,
      message: "conversationProviderId is required; no other settings may be changed by this endpoint.",
    }, 400);
  }

  const conversationProviderId = normalizeGHLConversationProviderId(
    (body as { conversationProviderId: unknown }).conversationProviderId,
  );
  if (!conversationProviderId) {
    return c.json({
      success: false,
      message: "conversationProviderId must be a valid provider identifier.",
    }, 400);
  }

  try {
    const { configurationRepository } = createRepositories(c.env.DB);
    const configuration = await configurationRepository.getByIntegrationId(crm.id);
    if (!configuration) {
      return c.json({
        success: false,
        message: "Configure the tenant's CRM integration before setting its Custom Conversation Provider.",
      }, 409);
    }

    await configurationRepository.save(crm.id, {
      ...configuration,
      providerConfiguration: {
        ...(configuration.providerConfiguration ?? {}),
        conversationProviderId,
      },
    });

    logger.info("GHL Custom Conversation Provider configured.", {
      tenantId: requestContext.tenant.id,
      locationConfigured: true,
    });

    return c.json({ success: true, conversationProviderId });
  } catch (error: unknown) {
    logger.error("Failed to update GHL Custom Conversation Provider configuration.", {
      tenantId: requestContext.tenant.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return c.json({
      success: false,
      message: "Unable to update Custom Conversation Provider configuration.",
    }, 500);
  }
}
