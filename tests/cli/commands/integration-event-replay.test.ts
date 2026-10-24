import assert from "node:assert/strict";
import test from "node:test";
import { parseEventReplayArguments } from "../../../src/cli/commands/integration-event-replay";

const base = ["replay", "--tenant", "tenant-a", "--event", "event-1"];

test("event replay defaults to a local preview and requires exact identity", () => {
  const parsed = parseEventReplayArguments(base);
  assert.equal(parsed.apply, false);
  assert.equal(parsed.remote, false);
  assert.throws(() => parseEventReplayArguments([
    ...base, "--apply", "--confirm", "tenant-a/other-event",
  ]), /Mutation requires/);
});

test("remote event replay requires explicit environment selection", () => {
  assert.throws(() => parseEventReplayArguments([...base, "--remote"]), /explicit --env/);
  assert.throws(() => parseEventReplayArguments([...base, "--env", "dev", "--remote"]), /limited to the configured/);
  const parsed = parseEventReplayArguments([
    ...base, "--env", "staging", "--remote", "--apply",
    "--confirm", "tenant-a/event-1",
  ]);
  assert.equal(parsed.environment, "staging");
  assert.equal(parsed.remote, true);
  assert.equal(parsed.apply, true);
});

test("base Wrangler configuration is an explicit remote target", () => {
  const parsed = parseEventReplayArguments([...base, "--env", "base", "--remote"]);
  assert.equal(parsed.environment, "base");
  assert.equal(parsed.remote, true);
  assert.equal(parsed.apply, false);
});

test("inspection cannot accept mutation flags", () => {
  assert.throws(() => parseEventReplayArguments([
    "inspect", "--tenant", "tenant-a", "--event", "event-1", "--apply",
  ]), /Inspection does not accept/);
});
