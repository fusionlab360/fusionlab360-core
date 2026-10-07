export interface OpportunityProviderIdentity {

  provider: string;

  providerOpportunityId: string;

}


export interface CanonicalOpportunityIdentity {

  canonicalOpportunityId: string;

  providerIdentities:
    OpportunityProviderIdentity[];

}