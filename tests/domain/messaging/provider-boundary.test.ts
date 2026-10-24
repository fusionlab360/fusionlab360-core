import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../../..");

test("generic inbound queue dispatches Meta through an injected provider handler", () => {
  const queueSource = readFileSync(resolve(root, "src/domain/messaging/inbound-queue.ts"), "utf8");
  const workerSource = readFileSync(resolve(root, "src/index.ts"), "utf8");
  assert.doesNotMatch(queueSource, /from ["'][^"']*meta-whatsapp[^"']*["']/);
  assert.doesNotMatch(queueSource, /processMetaWhatsAppInboundEvent/);
  assert.match(queueSource, /providerHandlers\?\.get\("meta_whatsapp"\)/);
  assert.match(workerSource, /createMetaWhatsAppInboundHandler/);
});
