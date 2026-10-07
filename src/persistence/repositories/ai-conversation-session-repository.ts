import {
  BaseRepository,
} from "./base-repository";


export type AIConversationSessionState =
  | "awaiting_choice"
  | "ai_active"
  | "handoff_pending"
  | "human_handoff";


export interface AIConversationSession {

  tenantId:
    string;

  provider:
    string;

  conversationId:
    string;

  state:
    AIConversationSessionState;

  sessionStartedAt:
    string;

  createdAt:
    string;

  updatedAt:
    string;
}


export class AIConversationSessionRepository
  extends BaseRepository {


  async find(
    tenantId:
      string,

    provider:
      string,

    conversationId:
      string,
  ): Promise<
    AIConversationSession | null
  > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM ai_conversation_sessions
          WHERE tenant_id = ?
            AND provider = ?
            AND conversation_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          provider,
          conversationId,
        )
        .first();


    if (!result) {

      return null;
    }


    return {

      tenantId:
        result.tenant_id as string,

      provider:
        result.provider as string,

      conversationId:
        result.conversation_id as string,

      state:
        result.state as
          AIConversationSessionState,

      sessionStartedAt:
        result.session_started_at as string,

      createdAt:
        result.created_at as string,

      updatedAt:
        result.updated_at as string,
    };
  }


  async upsert(
    tenantId:
      string,

    provider:
      string,

    conversationId:
      string,

    state:
      AIConversationSessionState,

    sessionStartedAt:
      string,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO ai_conversation_sessions (
          tenant_id,
          provider,
          conversation_id,
          state,
          session_started_at,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT(
          tenant_id,
          provider,
          conversation_id
        )
        DO UPDATE SET
          state = excluded.state,
          session_started_at =
            excluded.session_started_at,
          updated_at =
            CURRENT_TIMESTAMP
        `,
      )
      .bind(
        tenantId,
        provider,
        conversationId,
        state,
        sessionStartedAt,
      )
      .run();
  }
}