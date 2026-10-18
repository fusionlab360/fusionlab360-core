import { BaseRepository } from "./base-repository";

export interface CreateOAuthAuthorizationStateInput {
  stateHash: string;
  tenantId: string;
  integrationId: string;
  provider: string;
  purpose?: string;
  context?: Record<string, unknown>;
  expiresAt: number;
}

export interface ConsumedOAuthAuthorizationState {
  tenantId: string;
  integrationId: string;
  provider: string;
  purpose: string;
  context: Record<string, unknown>;
  expiresAt: number;
}

export class OAuthAuthorizationStateRepository
  extends BaseRepository
{
  async create(
    input: CreateOAuthAuthorizationStateInput,
  ): Promise<void> {
    if (!/^[a-f0-9]{64}$/i.test(input.stateHash)) {
      throw new Error(
        "OAuth state hash must be a SHA-256 hex digest.",
      );
    }

    if (
      !input.tenantId.trim() ||
      !input.integrationId.trim() ||
      !input.provider.trim()
    ) {
      throw new Error(
        "OAuth state requires tenant, integration and provider identifiers.",
      );
    }

    if (
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= Date.now()
    ) {
      throw new Error(
        "OAuth state expiration must be a future Unix timestamp in milliseconds.",
      );
    }

    const contextJson = JSON.stringify(
      input.context ?? {},
    );

    if (contextJson === undefined) {
      throw new Error(
        "OAuth state context must be JSON serializable.",
      );
    }

    const result = await this.db
  .prepare(
    `
      INSERT INTO oauth_authorization_states (
        state_hash,
        tenant_id,
        integration_id,
        provider,
        purpose,
        context_json,
        expires_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM integrations i
        WHERE i.id = ?
          AND i.tenant_id = ?
          AND i.provider = ?
      )
    `,
  )
  .bind(
    input.stateHash,
    input.tenantId,
    input.integrationId,
    input.provider,
    input.purpose ?? "connect",
    contextJson,
    input.expiresAt,
    input.integrationId,
    input.tenantId,
    input.provider,
  )
  .run();

    if ((result.meta?.changes ?? 0) !== 1) {
      throw new Error(
        "OAuth state could not be created for the matching tenant integration.",
      );
    }
  }

  /**
   * Atomically consumes an unexpired state.
   *
   * Unknown, expired, or previously consumed state returns null.
   * Only the request that successfully performs the conditional
   * UPDATE can proceed with the callback.
   */
  async consume(
    stateHash: string,
    now: number = Date.now(),
  ): Promise<ConsumedOAuthAuthorizationState | null> {
    if (!/^[a-f0-9]{64}$/i.test(stateHash)) {
      return null;
    }

    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error(
        "OAuth state consumption time must be a valid Unix timestamp in milliseconds.",
      );
    }

    const result = await this.db
  .prepare(
    `
      UPDATE oauth_authorization_states
      SET consumed_at = ?
      WHERE state_hash = ?
        AND consumed_at IS NULL
        AND expires_at > ?
        AND EXISTS (
          SELECT 1
          FROM integrations i
          WHERE i.id = oauth_authorization_states.integration_id
            AND i.tenant_id = oauth_authorization_states.tenant_id
            AND i.provider = oauth_authorization_states.provider
        )
    `,
  )
  .bind(now, stateHash, now)
  .run();

    if ((result.meta?.changes ?? 0) !== 1) {
      return null;
    }

    const row = await this.db
      .prepare(
        `
          SELECT
            tenant_id,
            integration_id,
            provider,
            purpose,
            context_json,
            expires_at
          FROM oauth_authorization_states
          WHERE state_hash = ?
            AND consumed_at = ?
          LIMIT 1
        `,
      )
      .bind(stateHash, now)
      .first<{
        tenant_id: string;
        integration_id: string;
        provider: string;
        purpose: string;
        context_json: string;
        expires_at: number;
      }>();

    if (!row) {
      return null;
    }

    let context: unknown;

    try {
      context = JSON.parse(row.context_json);
    } catch {
      throw new Error(
        "Stored OAuth state context is invalid JSON.",
      );
    }

    if (
      typeof context !== "object" ||
      context === null ||
      Array.isArray(context)
    ) {
      throw new Error(
        "Stored OAuth state context must be a JSON object.",
      );
    }

    return {
      tenantId: row.tenant_id,
      integrationId: row.integration_id,
      provider: row.provider,
      purpose: row.purpose,
      context: context as Record<string, unknown>,
      expiresAt: row.expires_at,
    };
  }
}