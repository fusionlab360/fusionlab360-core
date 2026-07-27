import type { RequestContext } from "../../context";

import type { Contact } from "./models/contact";
import type { ReservationOpportunity } from "../../domain/reservation/opportunity";

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
}