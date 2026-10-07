import readline from "node:readline/promises";

import * as process from "node:process";


const rl =
  readline.createInterface({

    input:
      process.stdin,

    output:
      process.stdout,
  });


export async function prompt(
  question:
    string,
): Promise<string> {

  const answer =
    await rl.question(
      question,
    );

  return answer.trim();
}


export function closePrompt() {
  rl.close();
}