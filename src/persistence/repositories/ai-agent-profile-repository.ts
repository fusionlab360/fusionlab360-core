import {
  BaseRepository,
} from "./base-repository";


import type {
  AIAgentProfile,
} from "../models/ai-agent-profile";


export class AIAgentProfileRepository
  extends BaseRepository {


  async findByTenant(
    tenantId:
      string,
  ):
    Promise<
      AIAgentProfile |
      null
    > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM ai_agent_profiles
          WHERE tenant_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
        )
        .first();


    if (
      !result
    ) {

      return null;
    }


    return {

      tenantId:
        result.tenant_id as string,

      agentName:
        result.agent_name as string,

      businessName:
        result.business_name as string,

      businessType:
        result.business_type as string,

      greetingTemplate:
        result.greeting_template as string,

      handoffTemplate:
        result.handoff_template as string,

      systemInstructions:
        result.system_instructions as string,

      aiInstructionsKnowledgeBaseId:
        (
          result.ai_instructions_knowledge_base_id as
            string |
            null
        ) ??
        undefined,

      createdAt:
        result.created_at as string,

      updatedAt:
        result.updated_at as string,
    };
  }


  async upsert(
    profile:
      AIAgentProfile,
  ):
    Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO ai_agent_profiles (
          tenant_id,
          agent_name,
          business_name,
          business_type,
          greeting_template,
          handoff_template,
          system_instructions,
          ai_instructions_knowledge_base_id,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT(tenant_id)
        DO UPDATE SET

          agent_name =
            excluded.agent_name,

          business_name =
            excluded.business_name,

          business_type =
            excluded.business_type,

          greeting_template =
            excluded.greeting_template,

          handoff_template =
            excluded.handoff_template,

          system_instructions =
            excluded.system_instructions,

          ai_instructions_knowledge_base_id =
            excluded.ai_instructions_knowledge_base_id,

          updated_at =
            CURRENT_TIMESTAMP
        `,
      )
      .bind(

        profile.tenantId,

        profile.agentName,

        profile.businessName,

        profile.businessType,

        profile.greetingTemplate,

        profile.handoffTemplate,

        profile.systemInstructions,

        profile.aiInstructionsKnowledgeBaseId ??
          null,
      )
      .run();
  }
}