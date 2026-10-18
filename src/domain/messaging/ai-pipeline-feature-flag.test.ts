import assert from "node:assert/strict";
import test from "node:test";

import {
  isAIPipelineV2TenantAllowed,
  scheduleAIPipelineShadowIfAllowed,
} from "./ai-pipeline-feature-flag";

test("disables the pipeline when the allowlist is missing", () => {
  assert.equal(
    isAIPipelineV2TenantAllowed("gmmetro", undefined),
    false,
  );

  assert.equal(
    isAIPipelineV2TenantAllowed("gmmetro", ""),
    false,
  );

  assert.equal(
    isAIPipelineV2TenantAllowed("gmmetro", " , "),
    false,
  );
});

test("allows an exact tenant ID", () => {
  assert.equal(
    isAIPipelineV2TenantAllowed("gmmetro", "gmmetro"),
    true,
  );
});

test("supports multiple comma-separated tenants", () => {
  assert.equal(
    isAIPipelineV2TenantAllowed(
      "gmmetro",
      "fusionlab360, gmmetro",
    ),
    true,
  );
});

test("normalizes whitespace and letter case", () => {
  assert.equal(
    isAIPipelineV2TenantAllowed(
      " GMMETRO ",
      " fusionlab360, gmmetro ",
    ),
    true,
  );
});

test("rejects partial tenant ID matches", () => {
  assert.equal(
    isAIPipelineV2TenantAllowed("gmmetro", "gm"),
    false,
  );
});

test("does not treat a wildcard as permission for every tenant", () => {
  assert.equal(
    isAIPipelineV2TenantAllowed("gmmetro", "*"),
    false,
  );
});

test("does not schedule or run shadow work for a non-allowlisted tenant", async () => {
  let schedulerCalls = 0;
  let taskCalls = 0;

  const scheduled = scheduleAIPipelineShadowIfAllowed({
    tenantId: "tenant-a",
    allowlist: "tenant-b",
    scheduleBackgroundTask() {
      schedulerCalls += 1;
    },
    async run() {
      taskCalls += 1;
    },
  });

  await Promise.resolve();

  assert.equal(scheduled, false);
  assert.equal(schedulerCalls, 0);
  assert.equal(taskCalls, 0);
});

test("schedules shadow work for an explicitly allowlisted tenant", async () => {
  let scheduledTask: Promise<unknown> | undefined;

  const scheduled = scheduleAIPipelineShadowIfAllowed({
    tenantId: "tenant-a",
    allowlist: "tenant-a",
    scheduleBackgroundTask(task: Promise<unknown>) {
      scheduledTask = task;
    },
    async run() {
      return "completed";
    },
  });

  assert.equal(scheduled, true);
  assert.ok(scheduledTask);
  assert.equal(await scheduledTask, "completed");
});