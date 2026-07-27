// src/config/security.ts

export const securityConfig = {
  jwt: {
    accessTokenTtl: "15m",
    refreshTokenTtl: "30d",
  },

  password: {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  },

  apiKey: {
    prefix: "fl360_",
  },
} as const;