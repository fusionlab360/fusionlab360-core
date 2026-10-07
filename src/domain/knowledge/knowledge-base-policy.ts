/*
 * --------------------------------------------------
 * Knowledge Base classification
 * --------------------------------------------------
 *
 * The Knowledge Base whose name is exactly:
 *
 *     AI Agent Instructions
 *
 * is reserved for deterministic AI instructions.
 *
 * Rich Text in every other Knowledge Base is treated
 * as normal business knowledge.
 */

export const AI_AGENT_INSTRUCTIONS_KB_NAME =
  "AI Agent Instructions";


export function isAIAgentInstructionsKnowledgeBase(
  name:
    string,
):
  boolean {

  return (
    name.trim() ===
    AI_AGENT_INSTRUCTIONS_KB_NAME
  );
}