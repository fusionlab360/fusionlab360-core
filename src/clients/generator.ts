import { randomBytes } from "node:crypto";

export function generateApiKey(): string {
  return `fl360_live_${randomBytes(24).toString("hex")}`;
}