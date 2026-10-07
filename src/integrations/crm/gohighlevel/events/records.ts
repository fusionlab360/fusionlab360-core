import {
  ghlFetchAuthenticated,
} from "../client";

import type {
  RequestContext,
} from "../../../../context";


export interface GHLEventRecordProperties {

  [key:
    string]:
    unknown;
}


export interface GHLEventRecord {

  id:
    string;

  properties?:
    GHLEventRecordProperties;
}


/*
 * --------------------------------------------------
 * Resolve GHL location ID
 * --------------------------------------------------
 */

function getLocationId(
  context:
    RequestContext,
): string {

  const locationId =
    context
      .tenant
      .integrations
      .crm
      .credentials
      .locationId
      .trim();


  if (
    !locationId
  ) {

    throw new Error(
      "GoHighLevel location ID is missing from tenant configuration.",
    );
  }


  return locationId;
}


/*
 * --------------------------------------------------
 * Create Event Record
 * --------------------------------------------------
 */

export async function createGHLEventRecord(
  context:
    RequestContext,

  schemaKey:
    string,

  properties:
    GHLEventRecordProperties,
) {

  const locationId =
    getLocationId(
      context,
    );


  return ghlFetchAuthenticated<{
    record: {
      id:
        string;
    };
  }>(
    context,

    `/objects/${encodeURIComponent(
      schemaKey,
    )}/records`,

    {
      method:
        "POST",

      body:
        JSON.stringify({
          locationId,

          properties,
        }),
    },
  );
}


/*
 * --------------------------------------------------
 * Search Event Record
 * --------------------------------------------------
 */

export async function searchGHLEventRecord(
  context:
    RequestContext,

  schemaKey:
    string,

  contactEvent:
    string,
) {

  const locationId =
    getLocationId(
      context,
    );


  return ghlFetchAuthenticated<{
    records:
      GHLEventRecord[];

    total:
      number;
  }>(
    context,

    `/objects/${encodeURIComponent(
      schemaKey,
    )}/records/search`,

    {
      method:
        "POST",

      body:
        JSON.stringify({
          locationId,

          page:
            1,

          pageLimit:
            10,

          query:
            contactEvent,

          searchAfter:
            [],
        }),
    },
  );
}


/*
 * --------------------------------------------------
 * Get Event Record
 * --------------------------------------------------
 */

export async function getGHLEventRecord(
  context:
    RequestContext,

  schemaKey:
    string,

  recordId:
    string,
) {

  const locationId =
    getLocationId(
      context,
    );


  return ghlFetchAuthenticated<{
    record?:
      GHLEventRecord;
  }>(
    context,

    `/objects/${encodeURIComponent(
      schemaKey,
    )}/records/${encodeURIComponent(
      recordId,
    )}?locationId=${encodeURIComponent(
      locationId,
    )}`,

    {
      method:
        "GET",
    },
  );
}


/*
 * --------------------------------------------------
 * Get Event Relations
 * --------------------------------------------------
 */

export async function getGHLEventRelations(
  context:
    RequestContext,

  contactId:
    string,

  associationId:
    string,
) {

  const locationId =
    getLocationId(
      context,
    );


  return ghlFetchAuthenticated<{
    relations:
      Array<{
        id:
          string;

        firstObjectKey:
          string;

        firstRecordId:
          string;

        secondObjectKey:
          string;

        secondRecordId:
          string;

        associationId:
          string;

        primary:
          boolean;

        locationId:
          string;
      }>;

    total:
      number;
  }>(
    context,

    `/associations/relations/${encodeURIComponent(
      contactId,
    )}?locationId=${encodeURIComponent(
      locationId,
    )}&skip=0&limit=100&associationIds=${encodeURIComponent(
      associationId,
    )}`,

    {
      method:
        "GET",
    },
  );
}


/*
 * --------------------------------------------------
 * Delete Event Record
 * --------------------------------------------------
 */

export async function deleteGHLEventRecord(
  context:
    RequestContext,

  schemaKey:
    string,

  recordId:
    string,
) {

  return ghlFetchAuthenticated<{
    id:
      string;

    success:
      boolean;
  }>(
    context,

    `/objects/${encodeURIComponent(
      schemaKey,
    )}/records/${encodeURIComponent(
      recordId,
    )}`,

    {
      method:
        "DELETE",
    },
  );
}


/*
 * --------------------------------------------------
 * Update Event Record
 * --------------------------------------------------
 */

export async function updateGHLEventRecord(
  context:
    RequestContext,

  schemaKey:
    string,

  recordId:
    string,

  properties:
    GHLEventRecordProperties,
) {

  const locationId =
    getLocationId(
      context,
    );


  return ghlFetchAuthenticated<{
    record: {
      id:
        string;
    };
  }>(
    context,

    `/objects/${encodeURIComponent(
      schemaKey,
    )}/records/${encodeURIComponent(
      recordId,
    )}?locationId=${encodeURIComponent(
      locationId,
    )}`,

    {
      method:
        "PUT",

      body:
        JSON.stringify({
          properties,
        }),
    },
  );
}


/*
 * --------------------------------------------------
 * Create Event Relation
 * --------------------------------------------------
 */

export async function createGHLEventRelation(
  context:
    RequestContext,

  associationId:
    string,

  firstRecordId:
    string,

  secondRecordId:
    string,
) {

  const locationId =
    getLocationId(
      context,
    );


  return ghlFetchAuthenticated<{
    relation: {
      id:
        string;
    };
  }>(
    context,

    "/associations/relations",

    {
      method:
        "POST",

      body:
        JSON.stringify({
          locationId,

          associationId,

          firstRecordId,

          secondRecordId,
        }),
    },
  );
}