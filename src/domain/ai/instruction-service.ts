import {
  KnowledgeSourceRepository,
} from "../../persistence/repositories/knowledge-source-repository";

import {
  KnowledgeDocumentRepository,
} from "../../persistence/repositories/knowledge-document-repository";

import {
  AI_AGENT_INSTRUCTIONS_KB_NAME,
} from "../knowledge/knowledge-base-policy";

const MAX_AI_INSTRUCTION_CHARS =
  12000;


/*
 * --------------------------------------------------
 * Reserved Knowledge Base
 * --------------------------------------------------
 *
 * A GHL Knowledge Base with this exact name is treated
 * as the tenant's deterministic AI instruction source.
 *
 * This is intentionally name-based rather than
 * profile-ID-based.
 */



/*
 * --------------------------------------------------
 * Load tenant-specific AI instructions
 * --------------------------------------------------
 *
 * The Core automatically finds the active GHL
 * Knowledge Base named exactly:
 *
 *     AI Agent Instructions
 *
 * Rich Text documents inside that Knowledge Base are
 * loaded deterministically and are NOT retrieved
 * through semantic RAG.
 */
export async function loadTenantAIInstructions(
  db:
    D1Database,

  tenantId:
    string,
):
  Promise<
    string
  > {

  /*
   * ------------------------------------------------
   * 1. Resolve the reserved Knowledge Base
   * ------------------------------------------------
   */

  const sourceRepository =
    new KnowledgeSourceRepository(
      db,
    );


  const sources =
    await sourceRepository
      .findByTenantProviderName(
        tenantId,

        "gohighlevel",

        AI_AGENT_INSTRUCTIONS_KB_NAME,
      );


  /*
   * ------------------------------------------------
   * No instruction Knowledge Base
   * ------------------------------------------------
   */

  if (
    sources.length ===
    0
  ) {

    return "";
  }


  /*
   * ------------------------------------------------
   * Multiple instruction Knowledge Bases
   * ------------------------------------------------
   *
   * Do not silently choose one.
   *
   * This prevents unpredictable AI behavior caused by
   * duplicate Knowledge Bases with the reserved name.
   */

  if (
    sources.length >
    1
  ) {

    throw new Error(
      `Multiple active GHL Knowledge Bases named "${AI_AGENT_INSTRUCTIONS_KB_NAME}" exist for tenant=${tenantId}. Exactly one is required.`,
    );
  }


  const source =
    sources[0];


  /*
   * ------------------------------------------------
   * 2. Load documents belonging to the source
   * ------------------------------------------------
   */

  const documentRepository =
    new KnowledgeDocumentRepository(
      db,
    );


  const documents =
    await documentRepository.findBySource(
      source.id,
    );


  /*
   * ------------------------------------------------
   * 3. Select active Rich Text documents
   * ------------------------------------------------
   *
   * Only Rich Text is interpreted as deterministic
   * AI instructions.
   *
   * FAQ, Website, File, Table, etc. remain normal
   * knowledge and are NOT injected directly into the
   * system prompt.
   */

  const instructionDocuments =
    documents
      .filter(
        (
          document,
        ) =>
          document.status ===
            "active" &&

          document.sourceType ===
            "rich_text" &&

          typeof document.content ===
            "string" &&

          document.content
            .trim()
            .length > 0,
      )
      .sort(
        (
          a,
          b,
        ) =>
          new Date(
            a.updatedAt ??
              "",
          ).getTime() -

          new Date(
            b.updatedAt ??
              "",
          ).getTime(),
      );


  if (
    instructionDocuments.length ===
    0
  ) {

    return "";
  }


  /*
   * ------------------------------------------------
   * 4. Combine instruction documents
   * ------------------------------------------------
   *
   * Multiple Rich Text documents are supported.
   */

  const instructions =
    instructionDocuments
      .map(
        (
          document,
        ) =>
          document.content!
            .trim(),
      )
      .join(
        "\n\n",
      )
      .slice(
        0,
        MAX_AI_INSTRUCTION_CHARS,
      )
      .trim();

      console.log(
  "AI AGENT INSTRUCTIONS LOADED",
  {
    tenantId,
    knowledgeSourceId:
      source.id,
    knowledgeBaseName:
      source.name,
    documentCount:
      instructionDocuments.length,
    instructionLength:
      instructions.length,
    instructionPreview:
      instructions.slice(
        0,
        300,
      ),
  },
);


  return instructions;
}