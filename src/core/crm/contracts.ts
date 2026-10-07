import type { RequestContext } from "../../context";

import type { Contact } from "./models/contact";
import type { ReservationOpportunity } from "../../domain/reservation/opportunity";

import type {
  ContactEventsSyncInput,
  ContactEventsSyncResult,
} from "./models/contact-event-sync";


export interface CRMAdapter {

  // Contact Operations
  createContact(
    context: RequestContext,
    payload: Contact
  ): Promise<Contact>;

  getContact(
    context: RequestContext,
    id: string
  ): Promise<Contact>;

  updateContact(
    context: RequestContext,
    id: string,
    payload: Partial<Contact>
  ): Promise<Contact>;

  upsertContact(
    context: RequestContext,
    payload: Contact
  ): Promise<Contact>;

  deleteContact(
    context: RequestContext,
    id: string
  ): Promise<void>;


  // Contact Operations
  createContact(
    context: RequestContext,
    payload: Contact
  ): Promise<Contact>;

  getContact(
    context: RequestContext,
    id: string
  ): Promise<Contact>;

  updateContact(
    context: RequestContext,
    id: string,
    payload: Partial<Contact>
  ): Promise<Contact>;

  upsertContact(
    context: RequestContext,
    payload: Contact
  ): Promise<Contact>;

  deleteContact(
    context: RequestContext,
    id: string
  ): Promise<void>;

// Contact Event Operations
  syncContactEvents(
    context: RequestContext,
    input: ContactEventsSyncInput,
  ): Promise<ContactEventsSyncResult>;

    // Opportunity Operations
  createOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity
  ): Promise<{
    id: string;
  }>;

  updateOpportunity(
    context: RequestContext,
    id: string,
    payload: Partial<ReservationOpportunity>
  ): Promise<{
    id: string;
  }>;

  searchContact(
  context: RequestContext,
  email: string
): Promise<Contact | undefined>;

  upsertOpportunity(
    context: RequestContext,
    payload: ReservationOpportunity
  ): Promise<{
    id: string;
  }>;

  searchOpportunity(
  context: RequestContext,
  contactId: string,
  reservationId: string,
): Promise<{
  id: string;
  pipelineStageId: string;
} | undefined>;

moveOpportunity(
  context: RequestContext,
  opportunityId: string,
  pipelineStageId: string,
): Promise<void>;

}