import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = readline.createInterface({
  input: stdin,
  output: stdout,
});

export async function prompt(question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

export async function closePrompt() {
  await rl.close();
}