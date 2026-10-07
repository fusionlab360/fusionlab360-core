import type { CRMAdapter } from "../../../core/crm";
import type { Contact } from "../../../core/crm/models/contact";
import type { RequestContext } from "../../../context";
import type { ReservationOpportunity } from "../../../domain/reservation/opportunity";

import { logger } from "../../../core/logger";

import { getGHLCredentials } from "./credentials";

import {
  createContact,
  getContact,
  updateContact,
  upsertContact,
  deleteContact,
  searchContact,
  getContactNotes,
  createContactNote,
  updateContactNote,
} from "./contacts";

import {
  createOpportunity,
  updateOpportunity,
  upsertOpportunity,
} from "./opportunities";

import {
  toGHLContact,
  fromGHLContact,
  toGHLPartialContact,
} from "./mapper/contact";

import {
  mapReservationOpportunityToGHL,
} from "./mapper/opportunity";

import {
  findReservationOpportunity,
} from "./opportunities/search";

import {
  moveOpportunity,
} from "./opportunities/update";


import type {
  ContactEventsSyncInput,
  ContactEventsSyncResult,
} from "../../../core/crm/models/contact-event-sync";

import {
  createGHLEventRecord,
  getGHLEventRecord,
  createGHLEventRelation,
  getGHLEventRelations,
  deleteGHLEventRecord,
} from "./events/records";

import type {
  GHLEventConfiguration,
} from "./events/config";

const FUSIONLAB_CONTACT_NOTE_TITLE =
  "FusionLab360 Contact Notes";

async function syncContactNotes(
  context:
    RequestContext,

  contactId:
    string,

  userId:
    string,

  notes?:
    string,
) {
  const body = notes?.trim();

  if (!body) {
    console.log(
      "GHL NOTES: skipped - empty notes",
    );

    return;
  }

  console.log(
    "GHL NOTES: starting",
    {
      contactId,
      userId,
      bodyLength: body.length,
    },
  );

  const response =
    await getContactNotes(
      context,
      contactId,
    );

  console.log(
    "GHL NOTES: existing notes",
    {
      count: response.notes?.length ?? 0,
      notes:
        response.notes?.map((note) => ({
          id: note.id,
          title: note.title,
          bodyLength: note.body?.length ?? 0,
        })),
    },
  );

  const existingNote =
    response.notes?.find(
      (note) =>
        note.title ===
        FUSIONLAB_CONTACT_NOTE_TITLE,
    );

  if (existingNote?.id) {
    console.log(
      "GHL NOTES: updating existing note",
      {
        noteId: existingNote.id,
      },
    );

    const result =
  await updateContactNote(
    context,

    contactId,

    existingNote.id,

    {
      userId,

      body,

      title:
        FUSIONLAB_CONTACT_NOTE_TITLE,
    },
  );

    console.log(
      "GHL NOTES: update successful",
      {
        noteId:
          result.note?.id ??
          existingNote.id,
      },
    );

    return;
  }

  console.log(
    "GHL NOTES: creating new note",
  );

  const result =
    await createContactNote(
      context,
      contactId,
      {
        userId,
        body,
        title:
          FUSIONLAB_CONTACT_NOTE_TITLE,
      },
    );

  console.log(
    "GHL NOTES: create successful",
    {
      noteId:
        result.note?.id,
    },
  );
}

function getGHLPropertyName(
  fieldKey: string,
): string {

  const normalized =
    fieldKey.trim();

  const parts =
    normalized.split(".");

  const propertyName =
    parts[parts.length - 1];

  if (
    !propertyName
  ) {
    throw new Error(
      `Invalid GHL field key '${fieldKey}'.`,
    );
  }

  return propertyName;
}

function getGHLEventConfiguration(
  context: RequestContext,
): GHLEventConfiguration {

  const providerConfiguration =
    context.tenant.integrations.crm
      .configuration
      ?.providerConfiguration;


  const rawConfiguration =
    providerConfiguration
      ?.contactEvents;


  if (
    typeof rawConfiguration !==
      "object" ||
    rawConfiguration ===
      null
  ) {
    throw new Error(
      "GoHighLevel Contact Events configuration is not configured.",
    );
  }


  const configuration =
    rawConfiguration as
      Partial<
        GHLEventConfiguration
      >;


  const requiredFields: Array<
    keyof GHLEventConfiguration
  > = [
    "schemaKey",
    "primaryDisplayFieldKey",
    "dateFieldKey",
    "typeFieldKey",
    "associationId",
    "firstObjectKey",
    "secondObjectKey",
  ];


  for (
    const field of
      requiredFields
  ) {

    if (
      typeof configuration[field] !==
        "string" ||
      !configuration[field]?.trim()
    ) {
      throw new Error(
        `GoHighLevel Contact Events configuration is missing '${field}'.`,
      );
    }
  }


  return {
    schemaKey:
      configuration.schemaKey!.trim(),

    primaryDisplayFieldKey:
      configuration.primaryDisplayFieldKey!.trim(),

    dateFieldKey:
      configuration.dateFieldKey!.trim(),

    typeFieldKey:
      configuration.typeFieldKey!.trim(),

    associationId:
      configuration.associationId!.trim(),

    firstObjectKey:
      configuration.firstObjectKey!.trim(),

    secondObjectKey:
      configuration.secondObjectKey!.trim(),
  };
}


function getGHLRecordProperty(
  properties:
    Record<
      string,
      unknown
    > | undefined,
  fieldKey: string,
): unknown {

  if (!properties) {
    return undefined;
  }


  if (
    Object.prototype.hasOwnProperty.call(
      properties,
      fieldKey,
    )
  ) {
    return properties[fieldKey];
  }


  const parts =
    fieldKey.split(".");


  const shortKey =
    parts[parts.length - 1];


  if (
    shortKey &&
    Object.prototype.hasOwnProperty.call(
      properties,
      shortKey,
    )
  ) {
    return properties[shortKey];
  }


  return undefined;
}


function normalizeEventDate(
  value: unknown,
): string | undefined {

  if (
    typeof value !==
    "string"
  ) {
    return undefined;
  }


  const trimmed =
    value.trim();


  if (!trimmed) {
    return undefined;
  }


  if (
    /^\d{4}-\d{2}-\d{2}/.test(
      trimmed,
    )
  ) {
    return trimmed.slice(
      0,
      10,
    );
  }


  return trimmed;
}


function normalizeEventType(
  value: unknown,
): string | undefined {

  if (
    typeof value !==
    "string"
  ) {
    return undefined;
  }


  const trimmed =
    value.trim();


  return trimmed ||
    undefined;
}


function buildContactEventKey(
  date: string,
  type: string,
): string {

  return `${date}:${type}`;
}

export const goHighLevelAdapter: CRMAdapter = {

  // -------------------------------------------------
  // CONTACTS
  // -------------------------------------------------

  async createContact(
    context: RequestContext,
    payload: Contact,
  ) {

        logger.info(
      "Creating GHL contact",
    );


    const response =
      await createContact(
        context,

        toGHLContact(
          context,
          payload,
        ),
      );


    logger.info(
      "GHL contact created",
      {
        contactId:
          response.contact.id,
      },
    );


    return fromGHLContact(
  context,
  response.contact,
);

  },


    async getContact(
    context:
      RequestContext,

    id:
      string,
  ) {

    logger.debug(
      "Fetching GHL contact",
      {
        id,
      },
    );


    const response =
      await getContact(
        context,

        id,
      );


    return fromGHLContact(
      context,

      response.contact,
    );

  },


   async updateContact(
  context:
    RequestContext,

  id:
    string,

  payload:
    Partial<Contact>,
) {

  logger.info(
    "Updating GHL contact",
    {
      id,
    },
  );


  /*
   * --------------------------------------------------
   * 1. Update normal contact fields
   * --------------------------------------------------
   */

  const response =
    await updateContact(
      context,

      id,

      toGHLPartialContact(
        payload,
      ),
    );


  /*
   * --------------------------------------------------
   * 2. Synchronize Contact Events
   * --------------------------------------------------
   *
   * The domain layer parses Notes into events[].
   *
   * The GHL adapter owns the provider-specific
   * persistence of those events.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "events",
    )
  ) {

    const events =
      payload.events ??
      [];


    logger.info(
      "GHL contact event synchronization requested",
      {
        contactId:
          id,

        eventCount:
          events.length,
      },
    );


    await this.syncContactEvents(
      context,

      {
        contactId:
          id,

        events,
      },
    );
  }


  logger.info(
    "GHL contact updated",
    {
      id,
    },
  );


  return fromGHLContact(
    context,

    response.contact,
  );
},
  
  async upsertContact(
    context: RequestContext,
    payload: Contact,
  ) {

    const credentials =
      getGHLCredentials(
        context,
      );


    const ghlPayload =
      toGHLContact(
        context,
        payload,
      );


    if (
      !ghlPayload.email &&
      !ghlPayload.phone
    ) {

      throw new Error(
        "GoHighLevel requires either email or phone.",
      );

    }


    logger.info(
      "Upserting GHL contact",
      {
        tenantId:
          context.tenant.id,

        locationId:
          credentials.locationId,

        email:
          ghlPayload.email,

        phone:
          ghlPayload.phone,
      },
    );


  try {
 const response =
  await upsertContact(
    context,

    ghlPayload,
  );

  console.log(
    "GHL UPSERT RESPONSE:",
    JSON.stringify(
      response,
      null,
      2,
    ),
  );

  const contactId =
  response.contact?.id;

if (!contactId) {
  throw new Error(
    "GoHighLevel contact upsert returned no contact ID.",
  );
}

const providerConfiguration =
  context.tenant.integrations.crm
    .configuration
    ?.providerConfiguration;

const noteUserId =
  typeof providerConfiguration?.userId === "string"
    ? providerConfiguration.userId
    : undefined;

if (payload.notes?.trim()) {
  if (!noteUserId) {
    throw new Error(
      "GoHighLevel userId is not configured.",
    );
  }

  await syncContactNotes(
  context,

  contactId,

  noteUserId,

  payload.notes,
);
}

logger.info(
  "GHL contact upsert completed",
  {
    contactId,
  },
);

  return fromGHLContact(
    context,
    response.contact,
  );
}
    catch (
      error: any
    ) {

      logger.error(
        "GHL contact upsert failed",
        {
          error,
        },
      );


      if (
        error?.message?.includes(
          "Pass at least one of number, email",
        )
      ) {

        throw new Error(
          "GoHighLevel requires either email or phone.",
        );

      }


      throw error;

    }

  },

      async deleteContact(
    context: RequestContext,
    id: string,
  ) {

    const credentials =
      getGHLCredentials(
        context,
      );


    const eventConfiguration =
      getGHLEventConfiguration(
        context,
      );


    const relations =
      await getGHLEventRelations(
        context,

        id,

        eventConfiguration.associationId,
      );


    const eventIsFirst =
      eventConfiguration.firstObjectKey ===
      eventConfiguration.schemaKey;


    const eventIsSecond =
      eventConfiguration.secondObjectKey ===
      eventConfiguration.schemaKey;


    if (
      !eventIsFirst &&
      !eventIsSecond
    ) {
      throw new Error(
        "GoHighLevel Contact Events association does not reference the configured event object.",
      );
    }


    const eventRecordIds =
      relations.relations
        ?.map(
          (relation) => {

            const contactRecordId =
              eventIsFirst
                ? relation.secondRecordId
                : relation.firstRecordId;


            const eventRecordId =
              eventIsFirst
                ? relation.firstRecordId
                : relation.secondRecordId;


            if (
              contactRecordId !==
              id
            ) {
              return undefined;
            }


            return eventRecordId;
          },
        )
        .filter(
          (
            recordId,
          ): recordId is string =>
            typeof recordId ===
            "string" &&
            recordId.length > 0,
        ) ??
      [];


    for (
      const eventRecordId of
        eventRecordIds
    ) {

      await deleteGHLEventRecord(
        context,

        eventConfiguration.schemaKey,

        eventRecordId,
      );
    }


    const response =
  await deleteContact(
    context,

    id,
  );


    if (
      !response.succeeded
    ) {
      throw new Error(
        "Failed to delete GoHighLevel contact.",
      );
    }


    logger.info(
      "GHL contact deleted",
      {
        id,

        deletedEventCount:
          eventRecordIds.length,
      },
    );
  },

  // -------------------------------------------------
  // CONTACT EVENT OPERATIONS
  // -------------------------------------------------

    async syncContactEvents(
    context: RequestContext,
    input: ContactEventsSyncInput,
  ): Promise<ContactEventsSyncResult> {

    const credentials =
      getGHLCredentials(
        context,
      );


    const eventConfiguration =
      getGHLEventConfiguration(
        context,
      );


    logger.info(
      "GHL contact event sync started",
      {
        tenantId:
          context.tenant.id,

        locationId:
          credentials.locationId,

        contactId:
          input.contactId,

        incomingEvents:
          input.events.map(
            (event) => ({
              date:
                event.date,

              type:
                event.type,
            }),
          ),
      },
    );


    /*
     * --------------------------------------------------
     * 1. Load all Event records associated with Contact
     * --------------------------------------------------
     */

    const relations =
      await getGHLEventRelations(
        context,

        input.contactId,

        eventConfiguration.associationId,
      );


    const eventIsFirst =
      eventConfiguration.firstObjectKey ===
      eventConfiguration.schemaKey;


    const eventIsSecond =
      eventConfiguration.secondObjectKey ===
      eventConfiguration.schemaKey;


    if (
      !eventIsFirst &&
      !eventIsSecond
    ) {
      throw new Error(
        "GoHighLevel Contact Events association does not reference the configured event object.",
      );
    }


    const existingEventRecordIds =
      relations.relations
        ?.map(
          (relation) => {

            const contactRecordId =
              eventIsFirst
                ? relation.secondRecordId
                : relation.firstRecordId;


            const eventRecordId =
              eventIsFirst
                ? relation.firstRecordId
                : relation.secondRecordId;


            if (
              contactRecordId !==
              input.contactId
            ) {
              return undefined;
            }


            return eventRecordId;
          },
        )
        .filter(
          (
            recordId,
          ): recordId is string =>
            typeof recordId ===
            "string" &&
            recordId.length > 0,
        ) ??
      [];


    logger.info(
      "GHL contact event relations loaded",
      {
        contactId:
          input.contactId,

        existingEventRecordCount:
          existingEventRecordIds.length,
      },
    );


    /*
     * --------------------------------------------------
     * 2. Read existing Event records
     * --------------------------------------------------
     *
     * We derive identity from the configured
     * date/type fields.
     *
     * No event_key field is required.
     */

    const existingEvents =
  new Map<
    string,
    string[]
  >();


    for (
      const eventRecordId of
        existingEventRecordIds
    ) {

      const eventResponse =
        await getGHLEventRecord(
          context,

          eventConfiguration.schemaKey,

          eventRecordId,
        );


      const properties =
        eventResponse.record?.properties;


      const existingDate =
        normalizeEventDate(
          getGHLRecordProperty(
            properties,
            eventConfiguration.dateFieldKey,
          ),
        );


      const existingType =
        normalizeEventType(
          getGHLRecordProperty(
            properties,
            eventConfiguration.typeFieldKey,
          ),
        );


      if (
        !existingDate ||
        !existingType
      ) {

        logger.warn(
          "GHL contact event record missing configured fields",
          {
            contactId:
              input.contactId,

            eventRecordId,

            dateFieldKey:
              eventConfiguration.dateFieldKey,

            typeFieldKey:
              eventConfiguration.typeFieldKey,
          },
        );


        continue;
      }


      const eventKey =
        buildContactEventKey(
          existingDate,
          existingType,
        );


      const existingRecordIds =
        existingEvents.get(
          eventKey,
        ) ?? [];

      existingRecordIds.push(
        eventRecordId,
      );

      existingEvents.set(
        eventKey,
        existingRecordIds,
      );
    }


    /*
     * --------------------------------------------------
     * 3. Build incoming event identity
     * --------------------------------------------------
     */

    const incomingEventKeys =
      new Set(
        input.events.map(
          (event) =>
            buildContactEventKey(
              event.date,
              event.type.trim(),
            ),
        ),
      );


    let created = 0;

    let deleted = 0;

    let kept = 0;


    /*
     * --------------------------------------------------
     * 4. Create missing events / keep existing events
     * --------------------------------------------------
     */

    for (
      const event of
        input.events
    ) {

      const normalizedType =
        event.type.trim();


      const eventKey =
        buildContactEventKey(
          event.date,
          normalizedType,
        );


      const existingRecordIds =
  existingEvents.get(
    eventKey,
  ) ?? [];


if (
  existingRecordIds.length > 0
) {

  const primaryRecordId =
    existingRecordIds[0];

  kept++;

  logger.info(
    "GHL contact event kept",
    {
      contactId:
        input.contactId,

      eventRecordId:
        primaryRecordId,

      eventDate:
        event.date,

      eventType:
        normalizedType,
    },
  );


  for (
    const duplicateRecordId of
      existingRecordIds.slice(1)
  ) {

    logger.info(
      "GHL duplicate contact event deleting",
      {
        contactId:
          input.contactId,

        eventRecordId:
          duplicateRecordId,

        eventKey,
      },
    );

    try {

      await deleteGHLEventRecord(
        context,

        eventConfiguration.schemaKey,

        duplicateRecordId,
      );

      deleted++;

    } catch (
      error:
        unknown
    ) {

      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error
          ? (
              error as {
                status?:
                  unknown;
              }
            ).status
          : undefined;

      if (
        status === 404
      ) {

        logger.warn(
          "GHL duplicate contact event already deleted",
          {
            contactId:
              input.contactId,

            eventRecordId:
              duplicateRecordId,

            eventKey,
          },
        );

        deleted++;

        continue;
      }

      throw error;
    }
  }

  continue;
}


      const eventLabel =
        `${normalizedType} - ${event.date}`;


      logger.info(
        "GHL contact event creating",
        {
          contactId:
            input.contactId,

          eventDate:
            event.date,

          eventType:
            normalizedType,
        },
      );


      /*
       * ------------------------------------------------
       * Build GHL properties dynamically.
       * ------------------------------------------------
       *
       * Every field key comes from tenant/provider
       * configuration.
       */

      const properties:
  Record<
    string,
    unknown
  > = {

    [
      getGHLPropertyName(
        eventConfiguration
          .primaryDisplayFieldKey,
      )
    ]:
      eventLabel,

    [
      getGHLPropertyName(
        eventConfiguration
          .dateFieldKey,
      )
    ]:
      event.date,

    [
      getGHLPropertyName(
        eventConfiguration
          .typeFieldKey,
      )
    ]:
      normalizedType,
  };


      const recordResponse =
        await createGHLEventRecord(
          context,

          eventConfiguration.schemaKey,

          properties,
        );


      const eventRecordId =
        recordResponse.record?.id;


      if (
        !eventRecordId
      ) {
        throw new Error(
          "GHL contact event creation returned no record ID.",
        );
      }


      /*
       * GHL association orientation is discovered,
       * not hardcoded.
       */

      const firstRecordId =
        eventIsFirst
          ? eventRecordId
          : input.contactId;


      const secondRecordId =
        eventIsFirst
          ? input.contactId
          : eventRecordId;


      await createGHLEventRelation(
          context,

          eventConfiguration.associationId,

          firstRecordId,

          secondRecordId,
        );


      created++;


      logger.info(
        "GHL contact event created",
        {
          contactId:
            input.contactId,

          eventRecordId,

          eventDate:
            event.date,

          eventType:
            normalizedType,
        },
      );
    }


    /*
     * --------------------------------------------------
     * 5. Delete Event records that no longer exist
     * --------------------------------------------------
     */

    for (
  const [
    eventKey,
    eventRecordIds,
  ] of existingEvents
) {

  if (
    incomingEventKeys.has(
      eventKey,
    )
  ) {
    continue;
  }


  for (
    const eventRecordId of
      eventRecordIds
  ) {

    logger.info(
      "GHL contact event deleting",
      {
        contactId:
          input.contactId,

        eventRecordId,

        eventKey,
      },
    );


    try {

      await deleteGHLEventRecord(
        context,

        eventConfiguration.schemaKey,

        eventRecordId,
      );

      deleted++;

    } catch (
      error:
        unknown
    ) {

      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error
          ? (
              error as {
                status?:
                  unknown;
              }
            ).status
          : undefined;


      if (
        status === 404
      ) {

        logger.warn(
          "GHL contact event already absent during deletion",
          {
            contactId:
              input.contactId,

            eventRecordId,

            eventKey,
          },
        );

        deleted++;

        continue;
      }


      throw error;
    }
  }
}
    logger.info(
      "GHL contact event sync completed",
      {
        contactId:
          input.contactId,

        created,

        kept,

        deleted,
      },
    );


    return {
      created,

      deleted,

      kept,
    };
  },

  async searchContact(
    context: RequestContext,
    email: string,
  ) {

    logger.debug(
      "Searching GHL contact",
      {
        email,
      },
    );


      const response =
      await searchContact(
        context,
        email,
      );


    if (
      !response.contact
    ) {

      logger.debug(
        "GHL contact not found",
        {
          email,
        },
      );


      return undefined;

    }


    logger.info(
      "GHL contact found",
      {
        contactId:
          response.contact.id,
      },
    );


    return fromGHLContact(
  context,
  response.contact,
);

  },


  // -------------------------------------------------
  // OPPORTUNITIES
  // -------------------------------------------------

  /**
   * Create a reservation opportunity.
   *
   * IMPORTANT:
   *
   * GoHighLevel's legacy POST /opportunities endpoint
   * currently returns 404 for this tenant/API combination.
   *
   * The supported operation already implemented in this
   * integration is POST /opportunities/upsert.
   *
   * The reservation lifecycle calls this method only
   * after it has determined that no matching reservation
   * opportunity exists, so using the Upsert endpoint here
   * preserves the Core create abstraction while avoiding
   * the obsolete GHL endpoint.
   */
  async createOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity,
  ) {

    const credentials =
      getGHLCredentials(
        context,
      );


    logger.info(
  "Creating GHL opportunity",
  {
    tenantId:
      context.tenant.id,

    locationId:
      credentials.locationId,

    reservationId:
      payload.reservationId,
  },
);


const ghlPayload =
  mapReservationOpportunityToGHL(
    context,
    payload,
  );


const response =
  await createOpportunity(
    context,

    ghlPayload,
  );


const opportunityId =
  response.opportunity?.id ??
  "";


if (
  !opportunityId
) {

  throw new Error(
    "GoHighLevel opportunity creation returned no opportunity ID.",
  );

}


logger.info(
  "GHL opportunity created",
  {
    opportunityId,
  },
);


return {
  id:
    opportunityId,
};

  },


  /**
   * Generic opportunity update.
   *
   * Lifecycle stage movement should use moveOpportunity()
   * below instead of rebuilding the complete reservation
   * opportunity payload.
   */
  async updateOpportunity(
    context: RequestContext,
    id: string,
    payload: Partial<ReservationOpportunity>,
  ) {

    const credentials =
      getGHLCredentials(
        context,
      );


    logger.info(
      "Updating GHL opportunity",
      {
        id,
      },
    );


    const ghlPayload =
  mapReservationOpportunityToGHL(
    context,
    payload as ReservationOpportunity,
);


/*
 * ----------------------------------------
 * EXISTING RESERVATION RICH-DATA UPDATE
 * ----------------------------------------
 *
 * This update is for reservation data:
 *
 * - guest name
 * - contact
 * - OTA/reference fields
 * - check-in/check-out
 * - room
 * - occupancy
 * - hotel/channel fields
 *
 * Lifecycle movement is NOT handled here.
 *
 * Lifecycle movement has its own dedicated
 * moveOpportunity() path.
 *
 * Therefore do not send:
 *
 *     pipelineId
 *     pipelineStageId
 *     status
 *
 * Otherwise a normal reservation edit could
 * accidentally move the opportunity backwards.
 */

const {
  pipelineId:
    _pipelineId,

  pipelineStageId:
    _pipelineStageId,

  status:
    _status,

  ...ghlUpdatePayload
} =
  ghlPayload;


const response =
  await updateOpportunity(
    context,

    id,

    ghlUpdatePayload,
  );


    logger.info(
      "GHL opportunity updated",
      {
        opportunityId:
          response.id,
      },
    );


    return {
      id:
        response.id ?? "",
    };

  },


  /**
   * Explicit GHL opportunity upsert.
   *
   * Retained for compatibility with the CRM contract.
   */
  async upsertOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity,
  ) {

    const credentials =
      getGHLCredentials(
        context,
      );


    logger.info(
      "Upserting GHL opportunity",
      {
        tenantId:
          context.tenant.id,

        locationId:
          credentials.locationId,

        reservationId:
          payload.reservationId,
      },
    );


    const ghlPayload =
      mapReservationOpportunityToGHL(
        context,
        payload,
      );


   const response =
  await upsertOpportunity(
    context,

    ghlPayload,
  );


    const opportunityId =
      response.opportunity?.id ??
      "";


    if (
      !opportunityId
    ) {

      throw new Error(
        "GoHighLevel opportunity upsert returned no opportunity ID.",
      );

    }


    logger.info(
      "GHL opportunity upsert completed",
      {
        opportunityId,
      },
    );


    return {
      id:
        opportunityId,
    };

  },


  // -------------------------------------------------
  // RESERVATION OPPORTUNITY SEARCH
  // -------------------------------------------------

  async searchOpportunity(
    context: RequestContext,
    contactId: string,
    reservationId: string,
  ) {

    const credentials =
      getGHLCredentials(
        context,
      );


    const reservationMapping =
      context
        .tenant
        .integrations
        .crm
        .configuration
        ?.attributeMappings
        .find(
          (mapping) =>
            mapping.canonicalKey ===
            "reservation.id",
        );


    // -------------------------------------------------
    // No Reservation ID field configured.
    //
    // We cannot safely identify a reservation opportunity
    // among multiple bookings for the same contact.
    // -------------------------------------------------

    if (
      !reservationMapping
    ) {

      logger.debug(
        "Reservation ID CRM field mapping not configured; opportunity search skipped",
        {
          tenantId:
            context.tenant.id,

          reservationId,
        },
      );


      return undefined;

    }


    logger.debug(
      "Searching GHL reservation opportunity",
      {
        tenantId:
          context.tenant.id,

        locationId:
          credentials.locationId,

        contactId,

        reservationId,
      },
    );


    const opportunity =
  await findReservationOpportunity(
    context,

    contactId,

    reservationMapping.providerFieldId,

    reservationId,
  );


    if (
      !opportunity?.id
    ) {

      logger.debug(
        "GHL reservation opportunity not found",
        {
          reservationId,
          contactId,
        },
      );


      return undefined;

    }


    logger.info(
      "GHL reservation opportunity found",
      {
        opportunityId:
          opportunity.id,

        reservationId,

        currentStage:
          opportunity.pipelineStageId,
      },
    );


    return {

      id:
        opportunity.id,

      pipelineStageId:
        opportunity.pipelineStageId,

    };

  },


  // -------------------------------------------------
  // OPPORTUNITY STAGE MOVEMENT
  // -------------------------------------------------

  async moveOpportunity(
    context: RequestContext,
    opportunityId: string,
    pipelineStageId: string,
  ) {

    const credentials =
      getGHLCredentials(
        context,
      );


    logger.info(
      "Moving GHL opportunity stage",
      {
        opportunityId,

        pipelineStageId,
      },
    );


   await moveOpportunity(
  context,

  opportunityId,

  pipelineStageId,
);


    logger.info(
      "GHL opportunity stage moved",
      {
        opportunityId,

        pipelineStageId,
      },
    );

  },

};