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
          workflow: {
            key: "reservation",

            providerWorkflowId: "tSJmWqlxzV6IqQxgTkaW",

            states: [
              {
                key: "new_reservation",
                providerStateId: "69e57484-a1e2-482f-83e5-d2d7d516d3ff",
              },
            ],
          },

          attributeMappings: [
            {
              canonicalKey: "reservation.id",
              providerFieldId: "reservationId",
              providerFieldName: "Reservation ID",
            },
            {
              canonicalKey: "reservation.provider",
              providerFieldId: "provider",
              providerFieldName: "Provider",
            },
            {
              canonicalKey: "reservation.roomType",
              providerFieldId: "roomType",
              providerFieldName: "Room Type",
            },
            {
              canonicalKey: "reservation.roomNumber",
              providerFieldId: "roomNumber",
              providerFieldName: "Room Number",
            },
            {
              canonicalKey: "reservation.checkIn",
              providerFieldId: "checkIn",
              providerFieldName: "Check In",
            },
            {
              canonicalKey: "reservation.checkOut",
              providerFieldId: "checkOut",
              providerFieldName: "Check Out",
            },
            {
              canonicalKey: "reservation.adults",
              providerFieldId: "adults",
              providerFieldName: "Adults",
            },
            {
              canonicalKey: "reservation.children",
              providerFieldId: "children",
              providerFieldName: "Children",
            },
            {
              canonicalKey: "reservation.channelSource",
              providerFieldId: "channelSource",
              providerFieldName: "Channel Source",
            },
            {
              canonicalKey: "reservation.paymentStatus",
              providerFieldId: "paymentStatus",
              providerFieldName: "Payment Status",
            },
            {
              canonicalKey: "reservation.bookingDate",
              providerFieldId: "bookingDate",
              providerFieldName: "Booking Date",
            },
          ],
        },
      },

      pms: {
        provider: "browser",
      },
    },
  },
];