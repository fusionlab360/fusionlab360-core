export type CoreAIAnswerabilityDecision =
  | "answer"
  | "answer_partial"
  | "handoff";

export type CoreAIAnswerabilityConfidence =
  | "high"
  | "medium"
  | "low";

export type CoreAIKnowledgeCoverageStatus =
  | "none"
  | "partial"
  | "complete";

export interface CoreAIAnswerability {
  decision:
    CoreAIAnswerabilityDecision;

  confidence:
    CoreAIAnswerabilityConfidence;

  reason:
    string;
}

/*
 * --------------------------------------------------
 * Core AI answerability decision
 * --------------------------------------------------
 *
 * This is application policy.
 *
 * It does not depend on:
 * - Gemini
 * - Cloudflare Workers AI
 * - GHL
 * - Vectorize
 * - Clinic
 * - Hotel
 * - Booking
 *
 * Tenant AI Agent Instructions are configuration only.
 * They are never evidence for this decision.
 * --------------------------------------------------
 */

export function resolveCoreAIAnswerability(
  policyRequiresKnowledge:
    boolean,

  hasApprovedKnowledge:
    boolean,

  knowledgeCoverageStatus:
    CoreAIKnowledgeCoverageStatus,

  knowledgeAttributeCoverageStatus:
    CoreAIKnowledgeCoverageStatus,

  hasRequestedAttributes:
    boolean,
):
  CoreAIAnswerability {

  /*
   * Normal conversation does not require
   * business knowledge.
   */

  if (
    !policyRequiresKnowledge
  ) {

    return {
      decision:
        "answer",

      confidence:
        "high",

      reason:
        "normal_conversation",
    };
  }

  /*
   * Business request with no approved evidence.
   */

  if (
    !hasApprovedKnowledge
  ) {

    return {
      decision:
        "handoff",

      confidence:
        "low",

      reason:
        "no_approved_knowledge",
    };
  }

  /*
   * Retrieved knowledge exists, but none of
   * the requested information categories are
   * actually covered.
   */

  if (
    knowledgeCoverageStatus ===
    "none"
  ) {

    return {
      decision:
        "handoff",

      confidence:
        "low",

      reason:
        "no_requested_intent_coverage",
    };
  }

  /*
   * The customer explicitly requested attributes,
   * but none are confirmed.
   */

  if (
    hasRequestedAttributes &&
    knowledgeAttributeCoverageStatus ===
      "none"
  ) {

    return {
      decision:
        "handoff",

      confidence:
        "low",

      reason:
        "no_requested_attribute_coverage",
    };
  }

  /*
   * We can safely answer part of the question,
   * but not everything.
   */

  if (
    knowledgeCoverageStatus ===
      "partial" ||
    (
      hasRequestedAttributes &&
      knowledgeAttributeCoverageStatus ===
        "partial"
    )
  ) {

    return {
      decision:
        "answer_partial",

      confidence:
        "medium",

      reason:
        "partial_knowledge_coverage",
    };
  }

  /*
   * All requested business information is covered.
   */

  return {
    decision:
      "answer",

    confidence:
      "high",

    reason:
      "complete_knowledge_coverage",
  };
}