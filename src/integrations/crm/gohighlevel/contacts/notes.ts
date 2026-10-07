import {
  ghlFetchAuthenticated,
} from "../client";

import {
  GHL,
} from "../config";

import type {
  RequestContext,
} from "../../../../context";


/**
 * GoHighLevel Contact Note
 */
export interface GHLContactNote {

  id:
    string;

  body?:
    string;

  title?:
    string;

  pinned?:
    boolean;

  dateAdded?:
    string;

  dateUpdated?:
    string;
}


/**
 * GoHighLevel Contact Note payload.
 *
 * GHL requires userId and body when
 * creating or updating a contact note.
 */
export interface GHLContactNotePayload {

  userId:
    string;

  body:
    string;

  title?:
    string;

  color?:
    string;

  pinned?:
    boolean;
}


/**
 * Get all notes for a GHL contact.
 */
export async function getContactNotes(
  context:
    RequestContext,

  contactId:
    string,
) {

  if (
    !contactId.trim()
  ) {

    throw new Error(
      "Contact ID is required.",
    );
  }


  return ghlFetchAuthenticated<{
    notes:
      GHLContactNote[];
  }>(
    context,

    `${GHL.ENDPOINTS.CONTACTS}/${encodeURIComponent(
      contactId,
    )}/notes`,
  );
}


/**
 * Create a native GHL contact note.
 */
export async function createContactNote(
  context:
    RequestContext,

  contactId:
    string,

  payload:
    GHLContactNotePayload,
) {

  if (
    !contactId.trim()
  ) {

    throw new Error(
      "Contact ID is required.",
    );
  }


  return ghlFetchAuthenticated<{
    note:
      GHLContactNote;
  }>(
    context,

    `${GHL.ENDPOINTS.CONTACTS}/${encodeURIComponent(
      contactId,
    )}/notes`,

    {
      method:
        "POST",

      body:
        JSON.stringify(
          payload,
        ),
    },
  );
}


/**
 * Update an existing native GHL contact note.
 */
export async function updateContactNote(
  context:
    RequestContext,

  contactId:
    string,

  noteId:
    string,

  payload:
    GHLContactNotePayload,
) {

  if (
    !contactId.trim()
  ) {

    throw new Error(
      "Contact ID is required.",
    );
  }


  if (
    !noteId.trim()
  ) {

    throw new Error(
      "Note ID is required.",
    );
  }


  return ghlFetchAuthenticated<{
    note:
      GHLContactNote;
  }>(
    context,

    `${GHL.ENDPOINTS.CONTACTS}/${encodeURIComponent(
      contactId,
    )}/notes/${encodeURIComponent(
      noteId,
    )}`,

    {
      method:
        "PUT",

      body:
        JSON.stringify(
          payload,
        ),
    },
  );
}