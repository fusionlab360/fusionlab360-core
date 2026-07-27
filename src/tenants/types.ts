import type { FieldMappingCollection } from "../canonical/types";

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
      provider: CRMProvider;

      credentials: {
        apiKey: string;
        locationId: string;
      };

      configuration: {
        pipelines: {
          primary: {
            id: string;
            stageId: string;
          };
        };

        fieldMappings: FieldMappingCollection;
      };
    };

    pms: {
      provider: PMSProvider;
    };
  };
}