import {
  ghlFetch,
} from "../client";

import type {
  GHLEventConfiguration,
} from "./config";


interface GHLObjectSummary {
  id: string;

  key: string;

  standard?: boolean;

  labels?: {
    singular?: string;
    plural?: string;
  };

  locationId?: string;
}


interface GHLObjectField {
  id: string;

  fieldKey: string;

  name: string;

  dataType: string;

  objectKey: string;
}


interface GHLObjectSchemaResponse {
  object: {
    id: string;

    key: string;

    labels?: {
      singular?: string;
      plural?: string;
    };

    locationId: string;

    primaryDisplayProperty?: string;
  };

  fields: GHLObjectField[];
}


interface GHLObjectsResponse {
  objects: GHLObjectSummary[];
}


interface GHLAssociation {
  id: string;

  key: string;

  firstObjectKey: string;

  secondObjectKey: string;

  firstObjectLabel?: string;

  secondObjectLabel?: string;

  associationType?: string;

  locationId: string;
}


interface GHLAssociationsResponse {
  associations: GHLAssociation[];

  total?: number;
}


/**
 * List all Custom Objects available for a GHL location.
 *
 * No tenant-specific object key is hardcoded here.
 */
export async function listGHLObjects(
  apiKey: string,
  locationId: string,
): Promise<GHLObjectSummary[]> {

  const response =
    await ghlFetch<GHLObjectsResponse>(
      apiKey,
      `/objects/?locationId=${encodeURIComponent(
        locationId,
      )}`,
      {
        method: "GET",
      },
    );


  return Array.isArray(
    response.objects,
  )
    ? response.objects
    : [];
}


/**
 * Retrieve a complete GHL object schema,
 * including its fields.
 *
 * schemaKey is supplied by tenant/provider
 * configuration and is never hardcoded.
 */
export async function getGHLObjectSchema(
  apiKey: string,
  locationId: string,
  schemaKey: string,
): Promise<GHLObjectSchemaResponse> {

  const normalizedSchemaKey =
    schemaKey?.trim();


  if (!normalizedSchemaKey) {
    throw new Error(
      "GHL event schemaKey is required.",
    );
  }


  const response =
    await ghlFetch<GHLObjectSchemaResponse>(
      apiKey,
      `/objects/${encodeURIComponent(
        normalizedSchemaKey,
      )}?locationId=${encodeURIComponent(
        locationId,
      )}&fetchProperties=true`,
      {
        method: "GET",
      },
    );


  if (
    !response.object
  ) {
    throw new Error(
      `GHL object schema '${normalizedSchemaKey}' was not returned.`,
    );
  }


  if (
    response.object.locationId !==
    locationId
  ) {
    throw new Error(
      `GHL object '${normalizedSchemaKey}' does not belong to location '${locationId}'.`,
    );
  }


  return response;
}


/**
 * Discover all associations available
 * to the GHL location.
 */
export async function listGHLAssociations(
  apiKey: string,
  locationId: string,
): Promise<GHLAssociation[]> {

  const response =
    await ghlFetch<GHLAssociationsResponse>(
      apiKey,
      `/associations/?locationId=${encodeURIComponent(
        locationId,
      )}&skip=0&limit=100`,
      {
        method: "GET",
      },
    );


  return Array.isArray(
    response.associations,
  )
    ? response.associations
    : [];
}


/**
 * Find the Contact ↔ selected Event Object
 * association dynamically.
 *
 * The association ID itself is never hardcoded.
 *
 * "contact" is the GHL standard object key for
 * the Contact object; the tenant-specific event
 * object key comes from configuration.
 */
export function findContactEventAssociation(
  associations: GHLAssociation[],
  schemaKey: string,
): GHLAssociation {

  const normalizedSchemaKey =
    schemaKey.trim();


  const matches =
    associations.filter(
      (association) => {

        const eventIsFirst =
          association.firstObjectKey ===
          normalizedSchemaKey;

        const eventIsSecond =
          association.secondObjectKey ===
          normalizedSchemaKey;

        const contactIsFirst =
          association.firstObjectKey ===
          "contact";

        const contactIsSecond =
          association.secondObjectKey ===
          "contact";


        return (
          (
            eventIsFirst &&
            contactIsSecond
          ) ||
          (
            contactIsFirst &&
            eventIsSecond
          )
        );
      },
    );


  if (
    matches.length ===
    0
  ) {
    throw new Error(
      `No GHL association found between contact and event object '${normalizedSchemaKey}'.`,
    );
  }


  if (
    matches.length >
    1
  ) {
    throw new Error(
      `Multiple GHL associations found between contact and event object '${normalizedSchemaKey}'. Configure the intended association for this tenant.`,
    );
  }


  return matches[0];
}


/**
 * Validate that a configured field exists
 * in the selected GHL object schema.
 *
 * Field keys are supplied by configuration,
 * not hardcoded in Core.
 */
function requireGHLObjectField(
  fields: GHLObjectField[],
  fieldKey: string,
  fieldName: string,
): GHLObjectField {

  const normalizedFieldKey =
    fieldKey?.trim();


  if (!normalizedFieldKey) {
    throw new Error(
      `GHL ${fieldName} fieldKey is required.`,
    );
  }


  const field =
    fields.find(
      (candidate) =>
        candidate.fieldKey ===
        normalizedFieldKey,
    );


  if (!field) {
    throw new Error(
      `GHL ${fieldName} field '${normalizedFieldKey}' was not found in the configured object.`,
    );
  }


  return field;
}


/**
 * Resolve and validate the complete GHL
 * Contact Event configuration.
 *
 * The tenant supplies:
 *
 *   schemaKey
 *   dateFieldKey
 *   typeFieldKey
 *
 * GHL dynamically supplies:
 *
 *   associationId
 *   firstObjectKey
 *   secondObjectKey
 */
export async function discoverGHLEventConfiguration(
  apiKey: string,
  locationId: string,
  schemaKey: string,
  dateFieldKey: string,
  typeFieldKey: string,
): Promise<GHLEventConfiguration> {

  /*
   * --------------------------------------------------
   * 1. Retrieve the configured GHL object schema
   * --------------------------------------------------
   */

  const schema =
    await getGHLObjectSchema(
      apiKey,
      locationId,
      schemaKey,
    );


  const fields =
    Array.isArray(
      schema.fields,
    )
      ? schema.fields
      : [];


  /*
   * --------------------------------------------------
   * 2. Validate the configured date field
   * --------------------------------------------------
   */

  const dateField =
    requireGHLObjectField(
      fields,
      dateFieldKey,
      "event date",
    );


  const normalizedDateType =
    dateField.dataType
      ?.trim()
      .toUpperCase();


  if (
    normalizedDateType !==
    "DATE"
  ) {
    throw new Error(
      `GHL configured event date field '${dateField.fieldKey}' has data type '${dateField.dataType}', expected DATE.`,
    );
  }


  /*
   * --------------------------------------------------
   * 3. Validate the configured event type field
   * --------------------------------------------------
   */

  const typeField =
    requireGHLObjectField(
      fields,
      typeFieldKey,
      "event type",
    );


  const normalizedTypeType =
    typeField.dataType
      ?.trim()
      .toUpperCase();


  if (
    normalizedTypeType !==
      "TEXT" &&
    normalizedTypeType !==
      "STRING"
  ) {
    throw new Error(
      `GHL configured event type field '${typeField.fieldKey}' has data type '${typeField.dataType}', expected TEXT or STRING.`,
    );
  }


  /*
   * --------------------------------------------------
   * 4. Discover Contact ↔ Event association
   * --------------------------------------------------
   */

  const associations =
    await listGHLAssociations(
      apiKey,
      locationId,
    );


  const association =
    findContactEventAssociation(
      associations,
      schema.object.key,
    );


  /*
   * --------------------------------------------------
   * 5. Return provider-specific configuration
   * --------------------------------------------------
   */

  const primaryDisplayFieldKey =
  schema.object.primaryDisplayProperty?.trim();


if (!primaryDisplayFieldKey) {
  throw new Error(
    `GHL object '${schema.object.key}' does not expose a primary display property.`,
  );
}


return {
  schemaKey:
    schema.object.key,

  primaryDisplayFieldKey,

  dateFieldKey:
    dateField.fieldKey,

  typeFieldKey:
    typeField.fieldKey,

  associationId:
    association.id,

  firstObjectKey:
    association.firstObjectKey,

  secondObjectKey:
    association.secondObjectKey,
};
}