import { getPlatformProxy } from "wrangler";
import { IntegrationEventRepository } from "../../persistence/repositories/integration-event-repository";
import { IntegrationEventDeadLetterRepository } from "../../persistence/repositories/integration-event-dead-letter-repository";
import {
  inspectIntegrationEventReplay,
  replayDeadLetterIntegrationEvent,
} from "../../core/events/replay";
import type { GHLInboundQueueEnvelope } from "../../domain/messaging/inbound-queue-contract";
import { info, success, title } from "../utils/output";

interface CLIReplayEnvironment {
  DB: D1Database;
  GHL_INBOUND_QUEUE?: Queue<GHLInboundQueueEnvelope>;
}

export interface ParsedEventReplayArguments {
  action: "inspect" | "replay";
  tenantId: string;
  eventId: string;
  environment?: string;
  remote: boolean;
  apply: boolean;
}

export function parseEventReplayArguments(
  args: readonly string[],
): ParsedEventReplayArguments {
  const action = args[0];
  if (action !== "inspect" && action !== "replay") {
    throw new Error("Usage: integration-event:replay <inspect|replay> --tenant <id> --event <id> [--env <base|name>] [--remote] [--apply --confirm <tenant/event-id>]");
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote" || argument === "--apply") {
      if (flags.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
      flags.add(argument);
      continue;
    }
    if (!["--tenant", "--event", "--env", "--confirm"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--") || values.has(argument)) {
      throw new Error(`A single value is required for ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }
  const tenantId = values.get("--tenant");
  const eventId = values.get("--event");
  const environment = values.get("--env");
  const confirmation = values.get("--confirm");
  if (!tenantId?.trim() || tenantId !== tenantId.trim() || !eventId?.trim() || eventId !== eventId.trim()) {
    throw new Error("Both --tenant and --event are required without surrounding whitespace.");
  }
  if (flags.has("--remote") && !environment) {
    throw new Error("Remote operation requires explicit --env <base|name> selection.");
  }
  if (flags.has("--remote") && environment !== "base" && environment !== "staging") {
    throw new Error("Remote replay is limited to the configured base or staging environment.");
  }
  if (environment === "") throw new Error("Environment name cannot be empty.");
  if (action === "inspect" && (flags.has("--apply") || confirmation)) {
    throw new Error("Inspection does not accept mutation confirmation flags.");
  }
  if (flags.has("--apply") && confirmation !== `${tenantId}/${eventId}`) {
    throw new Error(`Mutation requires --confirm ${tenantId}/${eventId}.`);
  }
  if (!flags.has("--apply") && confirmation) {
    throw new Error("--confirm is only accepted together with --apply.");
  }
  return {
    action,
    tenantId,
    eventId,
    environment,
    remote: flags.has("--remote"),
    apply: flags.has("--apply"),
  };
}

export async function integrationEventReplayCommand(
  args: readonly string[] = process.argv.slice(3),
): Promise<void> {
  const parsed = parseEventReplayArguments(args);
  const platformEnvironment = parsed.environment && parsed.environment !== "base"
    ? parsed.environment
    : undefined;
  title(`Integration Event Replay — ${parsed.environment ?? "Wrangler base configuration"} (${parsed.remote ? "remote" : "local"})`);
  if (parsed.remote) info("Remote D1 and Queue bindings are enabled for this explicit invocation.");
  const platform = await getPlatformProxy<CLIReplayEnvironment>({
    environment: platformEnvironment,
    remoteBindings: parsed.remote,
  });
  try {
    const events = new IntegrationEventRepository(platform.env.DB);
    const deadLetters = new IntegrationEventDeadLetterRepository(platform.env.DB);
    const inspection = await inspectIntegrationEventReplay(
      events, deadLetters, parsed.tenantId, parsed.eventId,
    );
    if (!inspection) throw new Error("Integration event was not found for the specified tenant.");
    console.log(`Tenant: ${inspection.event.tenantId}`);
    console.log(`Event: ${inspection.event.eventId}`);
    console.log(`Type: ${inspection.event.eventType}`);
    console.log(`Provider: ${inspection.event.provider ?? "(none)"}`);
    console.log(`Status: ${inspection.event.processingStatus}`);
    console.log(`Processing attempts: ${inspection.event.processingAttempts ?? 0}`);
    console.log(`Dead-letter code: ${inspection.deadLetter?.errorCode ?? "(none)"}`);
    console.log(`Replay eligible: ${inspection.eligible ? "yes" : "no"} (${inspection.reason})`);
    if (parsed.action === "inspect") return;
    if (!inspection.eligible) throw new Error(`Event cannot be replayed (${inspection.reason}).`);
    if (!parsed.apply) {
      info(`Preview only. Re-run with --apply --confirm ${parsed.tenantId}/${parsed.eventId} to enqueue this exact persisted event identity.`);
      return;
    }
    await replayDeadLetterIntegrationEvent(
      platform.env.GHL_INBOUND_QUEUE,
      events,
      deadLetters,
      parsed.tenantId,
      parsed.eventId,
    );
    success("Persisted event identity submitted to the configured Queue.");
  } finally {
    await platform.dispose();
  }
}
