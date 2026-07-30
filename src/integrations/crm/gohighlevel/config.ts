export const GHL = {
  BASE_URL: "https://services.leadconnectorhq.com",
  API_VERSION: "2021-07-28",

  ENDPOINTS: {
    CONTACTS: "/contacts",
    OPPORTUNITIES: "/opportunities",
    OPPORTUNITIES_UPSERT: "/opportunities/upsert",
    PIPELINES: "/opportunities/pipelines",
    CUSTOM_FIELDS: "/locations",
  },
} as const;