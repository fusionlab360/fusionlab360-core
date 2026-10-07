import type {
  AIProvider,
} from "./contracts";


import {
  HybridAIProvider,
} from "./providers/hybrid";


import {
  createCloudflareAIProvider,
} from "../../integrations/ai/cloudflare/provider";


import {
  createGeminiAIProvider,
} from "../../integrations/ai/gemini/provider";


export interface AIProviderConfig {

  provider?:
    | "cloudflare"
    | "gemini"
    | "hybrid";


  geminiApiKey?:
    string;


  geminiModel?:
    string;
}


export function resolveAIProvider(
  ai:
    Ai,

  config?:
    AIProviderConfig,
):
  AIProvider {

  const provider =
    config?.provider ??
    "cloudflare";


  /*
   * --------------------------------------------------
   * Cloudflare only
   * --------------------------------------------------
   *
   * This preserves the existing behaviour.
   */

  if (
    provider ===
    "cloudflare"
  ) {

    return createCloudflareAIProvider(
      ai,
    );
  }


  /*
   * --------------------------------------------------
   * Gemini only
   * --------------------------------------------------
   */

  if (
    provider ===
    "gemini"
  ) {

    if (
      !config?.geminiApiKey
    ) {

      throw new Error(
        "Gemini provider selected but GEMINI_API_KEY is missing.",
      );
    }


    return createGeminiAIProvider(
      config.geminiApiKey,

      config.geminiModel,
    );
  }


  /*
   * --------------------------------------------------
   * Hybrid
   * --------------------------------------------------
   *
   * Cloudflare handles structured work.
   *
   * Gemini handles response/reasoning work.
   *
   * HybridAIProvider contains the actual routing
   * policy and Gemini → Cloudflare fallback.
   */

  if (
    provider ===
    "hybrid"
  ) {

    if (
      !config?.geminiApiKey
    ) {

      throw new Error(
        "Hybrid AI provider selected but GEMINI_API_KEY is missing.",
      );
    }


    const cloudflare =
      createCloudflareAIProvider(
        ai,
      );


    const gemini =
      createGeminiAIProvider(
        config.geminiApiKey,

        config.geminiModel,
      );


    return new HybridAIProvider(
      cloudflare,

      gemini,
    );
  }


  throw new Error(
    `Unsupported AI provider: ${provider}`,
  );
}