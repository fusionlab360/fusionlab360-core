import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_CONFIG } from "../config";

export function executeSql(sql: string): void {

  const tempFile = join(
    tmpdir(),
    `fusionlab360-${Date.now()}.sql`,
  );

  writeFileSync(tempFile, sql, "utf8");

  try {

    console.log("\nExecuting SQL...\n");

    execSync(
  `npx wrangler d1 execute ${CLI_CONFIG.database} --remote --yes --file="${tempFile}"`,
      {
        stdio: "inherit",
      },
    );

    console.log("\n✅ SQL executed successfully.");

  } finally {

    try {
      unlinkSync(tempFile);
    } catch {}

  }
}