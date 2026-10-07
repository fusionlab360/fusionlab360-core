export interface ContactProviderIdentity {

  provider: string;

  providerContactId: string;

}


export interface CanonicalContactIdentity {

  canonicalContactId: string;

  providerIdentities:
    ContactProviderIdentity[];

}