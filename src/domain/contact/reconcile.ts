import type {
  ContactProviderIdentity,
} from "./identity";


export type ContactIdentityMatch =
  | "provider_contact"
  | "none";


export interface ContactIdentityCandidate {

  canonicalContactId:
    string;

  provider:
    string;

  providerContactId:
    string;

}


export interface ContactIdentityResolution {

  match:
    ContactIdentityMatch;

  canonicalContactId?:
    string;

  providerIdentity:
    ContactProviderIdentity;

}


export function reconcileContactIdentity(
  providerIdentity:
    ContactProviderIdentity,
  candidates:
    ContactIdentityCandidate[],
): ContactIdentityResolution {

  const match =
    candidates.find(
      candidate =>

        candidate.provider ===
          providerIdentity.provider &&

        candidate.providerContactId ===
          providerIdentity.providerContactId,
    );


  if (match) {

    return {

      match:
        "provider_contact",

      canonicalContactId:
        match.canonicalContactId,

      providerIdentity,

    };

  }


  return {

    match:
      "none",

    providerIdentity,

  };

}