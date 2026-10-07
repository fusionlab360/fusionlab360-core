export const GHL = {

  BASE_URL:
    "https://services.leadconnectorhq.com",

  API_VERSION: 
      "v3",

  ENDPOINTS: {

    CONTACTS:
      "/contacts",

    OPPORTUNITIES:
      "/opportunities",

    OPPORTUNITIES_SEARCH:
      "/opportunities/search",

    OPPORTUNITIES_UPSERT:
      "/opportunities/upsert",

    PIPELINES:
      "/opportunities/pipelines",

    CUSTOM_FIELDS:
      "/locations",

  },

} as const;