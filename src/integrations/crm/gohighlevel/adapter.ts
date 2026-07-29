import type { CRMAdapter } from "../../../core/crm";
import type { Contact } from "../../../core/crm/models/contact";
import type { RequestContext } from "../../../context";
import type { ReservationOpportunity } from "../../../domain/reservation/opportunity";
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
  // ----------------------------
  // CONTACTS
  // ----------------------------

  async createContact(
    context: RequestContext,
    payload: Contact,
  ) {
    const credentials = getGHLCredentials(context);

    const response = await createContact(
      credentials.apiKey,
      credentials.locationId,
      toGHLContact(payload),
    );

    return fromGHLContact(response.contact);
  },

  async getContact(
    context: RequestContext,
    id: string,
  ) {
    const credentials = getGHLCredentials(context);

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

    const response = await updateContact(
      credentials.apiKey,
      id,
      toGHLPartialContact(payload),
    );

    return fromGHLContact(response.contact);
  },


  async upsertContact(
  context: RequestContext,
  payload: Contact,
) {
  const credentials = getGHLCredentials(context);

  const ghlPayload = toGHLContact(payload);

  console.log("===== GHL UPSERT CONTACT =====");
  console.log(JSON.stringify(ghlPayload, null, 2));

  try {

    const response = await upsertContact(
      credentials.apiKey,
      credentials.locationId,
      ghlPayload,
    );

    return fromGHLContact(response.contact);

  } catch (error) {

    console.error("===== GHL ERROR =====");
    console.error(error);

    throw error;

  }
},

  async deleteContact(
    context: RequestContext,
    id: string,
  ) {
    const credentials = getGHLCredentials(context);

    const response = await deleteContact(
      credentials.apiKey,
      id,
    );

    if (!response.succeeded) {
      throw new Error("Failed to delete contact.");
    }
  },

  
async searchContact(
  context: RequestContext,
  email: string,
) {
  const credentials = getGHLCredentials(context);

  const response = await searchContact(
  credentials.apiKey,
  credentials.locationId,
  email,
);

  if (!response.contact) {
    return undefined;
  }

  return fromGHLContact(response.contact);
},


  // ----------------------------
  // OPPORTUNITIES
  // ----------------------------

  async createOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity,
  ) {
    const credentials = getGHLCredentials(context);

    const response = await createOpportunity(
      credentials.apiKey,
      credentials.locationId,
      mapReservationOpportunityToGHL(context, payload),
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
    throw new Error("updateOpportunity is not implemented yet.");
  },

  async upsertOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity,
  ) {
    const credentials = getGHLCredentials(context);

    const response = await upsertOpportunity(
      credentials.apiKey,
      credentials.locationId,
      mapReservationOpportunityToGHL(context, payload),
    );

    return {
      id: response.opportunity.id ?? "",
    };
  },
};