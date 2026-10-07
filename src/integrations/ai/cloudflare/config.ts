export const CLOUDFLARE_AI = {
  provider:
    "cloudflare-workers-ai",

  model:
    "@cf/openai/gpt-oss-120b",

  defaultMaxTokens:
    360,

  defaultTemperature:
    0.2,

} as const;