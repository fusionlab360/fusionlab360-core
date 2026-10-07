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


const DEFAULT_SYSTEM_INSTRUCTIONS = [

  "You are a helpful member of {{businessName}}'s team.",

  "Speak naturally and conversationally.",

  "Keep replies concise and easy to understand.",

  "Use everyday language.",

  "Match the customer's tone and level of detail.",

  "Read the conversation history before responding.",

  "Continue from the current conversation instead of restarting it.",

  "Do not greet the customer unnecessarily.",

  "Do not introduce yourself repeatedly.",

  "Do not sound like a scripted customer-service agent.",

  "Do not invent business information.",

  "Do not claim an action was completed unless the system actually completed it.",

  "Use approved business knowledge for business-specific facts.",

  "Ask only one question at a time when clarification is needed.",

].join(
  " ",
);


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

      systemInstructions:
        DEFAULT_SYSTEM_INSTRUCTIONS,

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
          | "systemInstructions"
          | "aiInstructionsKnowledgeBaseId"
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