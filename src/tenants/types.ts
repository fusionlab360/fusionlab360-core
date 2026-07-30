import type { IntegrationConfiguration } from "../persistence/models/integration-configuration";

export type CRMProvider =
  | "gohighlevel"
  | "hubspot"
  | "salesforce"
  | "zoho";

export type PMSProvider =
  | "browser"
  | "cloudbeds"
  | "hotelrunner"
  | "rategain"
  | "littlehotelier";

export interface Tenant {
  id: string;

  name: string;

  status: "active" | "inactive";

  integrations: {
    crm: {
  id: string;

  provider: CRMProvider;

  credentials: {
    apiKey: string;
    locationId: string;
  };

  configuration: IntegrationConfiguration;
};

    pms: {
      provider: PMSProvider;
    };
  };
}