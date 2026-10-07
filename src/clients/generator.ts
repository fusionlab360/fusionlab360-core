import {
  randomBytes,
} from "node:crypto";


export function generateApiKey(): string {

  const bytes =
    randomBytes(
      24,
    );


  const hex =
    Array
      .from(
        bytes,
      )
      .map(
        (
          byte,
        ) =>
          byte
            .toString(
              16,
            )
            .padStart(
              2,
              "0",
            ),
      )
      .join(
        "",
      );


  return `fl360_live_${hex}`;
}