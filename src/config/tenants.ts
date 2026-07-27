import type { Tenant } from "../tenants/types";

export const TENANTS: Tenant[] = [
  {
    id: "gm-moments",
    name: "GM Moments",
    status: "active",

    integrations: {
      crm: {
        provider: "gohighlevel",

        credentials: {
    apiKey: "...",
    locationId: "...",
  },
               configuration: {
          pipelines: {
            primary: {
              id: "tSJmWqlxzV6IqQxgTkaW",
              stageId: "69e57484-a1e2-482f-83e5-d2d7d516d3ff",
            },
          },

          fieldMappings: {
            "reservation.id": {
              providerFieldId: "reservationId",
              providerFieldName: "Reservation ID",
            },

            "reservation.provider": {
              providerFieldId: "provider",
              providerFieldName: "Provider",
            },

            "reservation.roomType": {
              providerFieldId: "roomType",
              providerFieldName: "Room Type",
            },

            "reservation.checkIn": {
              providerFieldId: "checkIn",
              providerFieldName: "Check In",
            },

            "reservation.checkOut": {
              providerFieldId: "checkOut",
              providerFieldName: "Check Out",
            },
          },
        },
      },

      pms: {
        provider: "browser",
        
      },
    },
  },
];