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

export const goHighLevelAdapter: CRMAdapter = {

  // -------------------------------------------------
  // CONTACTS
  // -------------------------------------------------

  async createContact(
    context: RequestContext,
    payload: Contact,
  ) {

    const credentials = getGHLCredentials(context);

    logger.info("Creating GHL contact");

    const response = await createContact(
      credentials.apiKey,
      credentials.locationId,
      toGHLContact(
  context,
  payload,
),
    );

    logger.info("GHL contact created", {
      contactId: response.contact.id,
    });

    return fromGHLContact(response.contact);
  },

  async getContact(
    context: RequestContext,
    id: string,
  ) {

    const credentials = getGHLCredentials(context);

    logger.debug("Fetching GHL contact", {
      id,
    });

    const response = await getContact(
      credentials.apiKey,
      id,
    );

    return fromGHLContact(response.contact);
  },

  async updateContact(
    context: RequestContext,
    id: string,
    payload: Partial<Contact>,
  ) {

    const credentials = getGHLCredentials(context);

    logger.info("Updating GHL contact", {
      id,
    });

    const response = await updateContact(
      credentials.apiKey,
      id,
      toGHLPartialContact(payload),
    );

    logger.info("GHL contact updated", {
      id,
    });

    return fromGHLContact(response.contact);
  },

  async upsertContact(
    context: RequestContext,
    payload: Contact,
  ) {

    const credentials = getGHLCredentials(context);

    const ghlPayload =
  toGHLContact(
    context,
    payload,
  );

    if (!ghlPayload.email && !ghlPayload.phone) {
      throw new Error(
        "GoHighLevel requires either email or phone.",
      );
    }

    logger.info("Upserting GHL contact", {
      tenantId: context.tenant.id,
      locationId: credentials.locationId,
      email: ghlPayload.email,
      phone: ghlPayload.phone,
    });

    try {

      const response = await upsertContact(
        credentials.apiKey,
        credentials.locationId,
        ghlPayload,
      );

      logger.info("GHL contact upsert completed", {
        contactId: response.contact.id,
      });

      return fromGHLContact(response.contact);

    } catch (error: any) {

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

    const credentials = getGHLCredentials(context);

    logger.info("Deleting GHL contact", {
      id,
    });

    const response = await deleteContact(
      credentials.apiKey,
      id,
    );

    if (!response.succeeded) {
      throw new Error(
        "Failed to delete GoHighLevel contact.",
      );
    }

    logger.info("GHL contact deleted", {
      id,
    });
  },

  async searchContact(
    context: RequestContext,
    email: string,
  ) {

    const credentials = getGHLCredentials(context);

    logger.debug("Searching GHL contact", {
      email,
    });

    const response = await searchContact(
      credentials.apiKey,
      credentials.locationId,
      email,
    );

    if (!response.contact) {

      logger.debug("GHL contact not found", {
        email,
      });

      return undefined;
    }

    logger.info("GHL contact found", {
      contactId: response.contact.id,
    });

    return fromGHLContact(
      response.contact,
    );
  },

  // -------------------------------------------------
  // OPPORTUNITIES
  // -------------------------------------------------

  async createOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity,
  ) {

    const credentials =
      getGHLCredentials(context);

    logger.info(
      "Creating GHL opportunity",
    );

    const ghlPayload =
      mapReservationOpportunityToGHL(
        context,
        payload,
      );

    const response =
      await createOpportunity(
        credentials.apiKey,
        credentials.locationId,
        ghlPayload,
      );

    logger.info(
      "GHL opportunity created",
      {
        opportunityId: response.id,
      },
    );

    return {
      id: response.id ?? "",
    };
  },

  async updateOpportunity(
    context: RequestContext,
    id: string,
    payload: Partial<ReservationOpportunity>,
  ) {

    const credentials =
      getGHLCredentials(context);

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

    const response =
      await updateOpportunity(
        credentials.apiKey,
        id,
        ghlPayload,
      );

    logger.info(
      "GHL opportunity updated",
      {
        opportunityId: response.id,
      },
    );

    return {
      id: response.id ?? "",
    };
  },

  async upsertOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity,
  ) {

    const credentials =
      getGHLCredentials(context);

    logger.info(
      "Upserting GHL opportunity",
    );

    const ghlPayload =
      mapReservationOpportunityToGHL(
        context,
        payload,
      );

    const response =
      await upsertOpportunity(
        credentials.apiKey,
        credentials.locationId,
        ghlPayload,
      );

    logger.info(
      "GHL opportunity upsert completed",
      {
        opportunityId:
          response.opportunity.id,
      },
    );

    return {
      id:
        response.opportunity.id ?? "",
    };
  },
};