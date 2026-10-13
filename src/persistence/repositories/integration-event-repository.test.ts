import assert from "node:assert/strict";
import test from "node:test";
import { IntegrationEventRepository } from "./integration-event-repository";

class EventMemoryDatabase {
  status: string = "received";
  attempts = 0;
  leaseToken: string | null = null;
  leaseExpiresAt: string | null = null;

  prepare(sql: string) {
    const normalizedSql = sql.replace(/\s+/g, " ");
    let values: unknown[] = [];
    const statement = {
      bind: (...bindings: unknown[]) => {
        values = bindings;
        return statement;
      },
      first: async () => ({
        processing_status: this.status,
        processing_attempts: this.attempts,
        processing_lease_expires_at: this.leaseExpiresAt,
        processing_started_at: this.leaseExpiresAt,
      }),
      run: async () => {
        if (normalizedSql.includes("processing_attempts = processing_attempts + 1")) {
          const token = String(values[1]);
          const expiresAt = String(values[2]);
          const now = String(values[6]);
          const maxAttempts = Number(values[5]);
          if (this.attempts >= maxAttempts) return { meta: { changes: 0 } };
          const canClaim = this.status === "received" ||
            this.status === "failed" ||
            (this.status === "processing" &&
              (!this.leaseExpiresAt || this.leaseExpiresAt <= now));
          if (!canClaim) return { meta: { changes: 0 } };
          this.status = "processing";
          this.attempts += 1;
          this.leaseToken = token;
          this.leaseExpiresAt = expiresAt;
          return { meta: { changes: 1 } };
        }
        if (normalizedSql.includes("SET processing_status = 'dead_letter'")) {
          if (this.attempts >= Number(values[2])) {
            this.status = "dead_letter";
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (normalizedSql.includes("SET") && normalizedSql.includes("processed_at = ?")) {
          const suppliedToken = String(values[3]);
          if (this.status !== "processing" || suppliedToken !== this.leaseToken) {
            return { meta: { changes: 0 } };
          }
          this.status = "processed";
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return statement;
  }

  async batch(statements: D1PreparedStatement[]) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

test("concurrent event claims have one active lease", async () => {
  const db = new EventMemoryDatabase();
  const repository = new IntegrationEventRepository(db as unknown as D1Database);
  const args = [
    "tenant-1",
    "event-1",
    new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(),
    "lease-token",
    new Date(Date.now() + 120_000).toISOString(),
    5,
  ] as const;

  const results = await Promise.all([
    repository.claimForProcessing(...args),
    repository.claimForProcessing(...args),
  ]);

  assert.equal(results.filter((result) => result.state === "claimed").length, 1);
  assert.equal(results.filter((result) => result.state === "active").length, 1);
});

test("expired processing at the attempt limit becomes terminal", async () => {
  const db = new EventMemoryDatabase();
  db.status = "processing";
  db.attempts = 5;
  db.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
  const repository = new IntegrationEventRepository(db as unknown as D1Database);

  const result = await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(),
    "new-token", new Date(Date.now() + 120_000).toISOString(), 5,
  );

  assert.equal(result.state, "exhausted");
  assert.equal(db.status, "dead_letter");
});

test("expired event lease is recoverable and stale owner cannot complete it", async () => {
  const db = new EventMemoryDatabase();
  const repository = new IntegrationEventRepository(db as unknown as D1Database);
  const now = new Date().toISOString();
  const firstClaim = await repository.claimForProcessing(
    "tenant-1", "event-1", now,
    new Date(Date.now() - 120_000).toISOString(),
    "first-token", new Date(Date.now() + 120_000).toISOString(), 5,
  );
  assert.equal(firstClaim.state, "claimed");

  db.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
  const recovered = await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(),
    "second-token", new Date(Date.now() + 120_000).toISOString(), 5,
  );
  assert.equal(recovered.state, "claimed");

  const staleCompletion = await repository.markProcessed(
    "tenant-1", "event-1", new Date().toISOString(), "first-token",
  );
  const currentCompletion = await repository.markProcessed(
    "tenant-1", "event-1", new Date().toISOString(), "second-token",
  );
  assert.equal(staleCompletion, false);
  assert.equal(currentCompletion, true);
});
