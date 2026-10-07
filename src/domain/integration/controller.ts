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
          credentials.apiKey,
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
          credentials.apiKey,
          credentials.locationId,
          schemaKey,
        ),

        listGHLAssociations(
          credentials.apiKey,
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