import {
  AIAgentProfileRepository,
} from "../../persistence/repositories/ai-agent-profile-repository";

import type {
  AIAgentProfile,
} from "../../persistence/models/ai-agent-profile";


const DEFAULT_AGENT_NAME =
  "AI Assistant";


const DEFAULT_BUSINESS_TYPE =
  "business";


const DEFAULT_GREETING_TEMPLATE =
  "Hi! How can I help?";


const DEFAULT_HANDOFF_TEMPLATE =
  "Sure, I'll leave this with the {{businessName}} team.";



export class AIAgentProfileService {

  constructor(
    private readonly repository:
      AIAgentProfileRepository,
  ) {}


  async getOrCreate(
    tenantId:
      string,

    tenantName:
      string,
  ): Promise<
    AIAgentProfile
  > {

    const existing =
      await this.repository.findByTenant(
        tenantId,
      );


    if (
      existing
    ) {

      return existing;
    }


    const profile:
      AIAgentProfile = {

      tenantId,

      agentName:
        DEFAULT_AGENT_NAME,

      businessName:
        tenantName,

      businessType:
        DEFAULT_BUSINESS_TYPE,

      greetingTemplate:
        DEFAULT_GREETING_TEMPLATE,

      handoffTemplate:
        DEFAULT_HANDOFF_TEMPLATE,

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),

    };


    await this.repository.upsert(
      profile,
    );


    return profile;
  }


  async update(
    tenantId:
      string,

    existing:
      AIAgentProfile,

    input:
      Partial<
        Pick<
          AIAgentProfile,

          | "agentName"
          | "businessName"
          | "businessType"
          | "greetingTemplate"
          | "handoffTemplate"
        >
      >
      ,
  ): Promise<
    AIAgentProfile
  > {

    const updated:
      AIAgentProfile = {

      ...existing,

      ...input,

      tenantId,

      updatedAt:
        new Date().toISOString(),

    };


    await this.repository.upsert(
      updated,
    );


    return updated;
  }
}