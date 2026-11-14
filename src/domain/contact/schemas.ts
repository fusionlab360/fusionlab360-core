export interface CreateContactRequest {
  id?: string;

  firstName: string;
  lastName?: string;

  email?: string;
  phone?: string;

  identityNumber?: string;
  identityType?: string;

  nationality?: string;

  lastVisitedDate?: string;

  notes?: string;
  clinicNotesSync?: "replace" | "clear" | "note_only";
  clinicNotesCapturedAt?: number;
  source?: string;

  branch?: string;
}