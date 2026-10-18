import { prompt } from "./prompt";

export type ProvisioningEnvironment = "staging" | "production";

export async function confirmProvisioningEnvironment(
  operationDescription: string,
): Promise<ProvisioningEnvironment> {
  const rawTarget = await prompt(
    "Target environment (staging/production) [staging]: ",
  );

  const target = (rawTarget || "staging").toLowerCase();

  if (target === "staging") {
    return "staging";
  }

  if (target !== "production") {
    throw new Error(
      "Invalid environment. Choose staging or production.",
    );
  }

  const expected = `PRODUCTION ${operationDescription}`;
  const confirmation = await prompt(
    `Production write. Type exactly "${expected}" to continue: `,
  );

  if (confirmation !== expected) {
    throw new Error(
      "Production operation cancelled; no write was performed.",
    );
  }

  return "production";
}