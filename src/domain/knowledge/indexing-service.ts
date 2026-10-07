import {
  KnowledgeDocumentRepository,
} from "../../persistence/repositories/knowledge-document-repository";

import {
  KnowledgeSourceRepository,
} from "../../persistence/repositories/knowledge-source-repository";

import {
  createKnowledgeEmbeddings,
} from "../../integrations/knowledge/vectorize/embedding";

import type {
  KnowledgeDocumentRecord,
} from "../../persistence/models/knowledge-document";

import {
  isAIAgentInstructionsKnowledgeBase,
} from "./knowledge-base-policy";


const MAX_CHUNK_CHARS =
  1400;

const CHUNK_OVERLAP_CHARS =
  200;


/*
 * --------------------------------------------------
 * Result returned by tenant-wide knowledge indexing
 * --------------------------------------------------
 */

export interface KnowledgeIndexResult {

  tenantId:
    string;

  documentsIndexed:
    number;

  chunksIndexed:
    number;

  skippedDocuments:
    number;

  vectorizeMutations:
    string[];
}


/*
 * --------------------------------------------------
 * Searchable knowledge chunk
 * --------------------------------------------------
 */

interface KnowledgeChunk {

  index:
    number;

  content:
    string;
}


/*
 * --------------------------------------------------
 * Split knowledge content into searchable chunks
 * --------------------------------------------------
 */

function chunkContent(
  content:
    string,
):
  KnowledgeChunk[] {

  const normalized =
    content
      .replace(
        /\r\n/g,
        "\n",
      )
      .replace(
        /\r/g,
        "\n",
      )
      .trim();


  if (
    !normalized
  ) {

    return [];
  }


  const chunks:
    KnowledgeChunk[] = [];


  let start =
    0;


  let index =
    0;


  while (
    start <
    normalized.length
  ) {

    const end =
      Math.min(
        start +
          MAX_CHUNK_CHARS,

        normalized.length,
      );


    let chunkEnd =
      end;


    /*
     * ------------------------------------------------
     * Prefer paragraph boundaries
     * ------------------------------------------------
     */

    if (
      end <
      normalized.length
    ) {

      const paragraphBreak =
        normalized.lastIndexOf(
          "\n\n",
          end,
        );


      const sentenceBreak =
        Math.max(
          normalized.lastIndexOf(
            ". ",
            end,
          ),

          normalized.lastIndexOf(
            "? ",
            end,
          ),

          normalized.lastIndexOf(
            "! ",
            end,
          ),
        );


      if (
        paragraphBreak >
        start +
          Math.floor(
            MAX_CHUNK_CHARS *
              0.5,
          )
      ) {

        chunkEnd =
          paragraphBreak;

      } else if (
        sentenceBreak >
        start +
          Math.floor(
            MAX_CHUNK_CHARS *
              0.5,
          )
      ) {

        chunkEnd =
          sentenceBreak +
          1;
      }
    }


    const text =
      normalized
        .slice(
          start,
          chunkEnd,
        )
        .trim();


    if (
      text
    ) {

      chunks.push({

        index,

        content:
          text,
      });


      index +=
        1;
    }


    /*
     * ------------------------------------------------
     * Finished
     * ------------------------------------------------
     */

    if (
      chunkEnd >=
      normalized.length
    ) {

      break;
    }


    /*
     * ------------------------------------------------
     * Move forward with overlap
     * ------------------------------------------------
     */

    start =
      Math.max(
        chunkEnd -
          CHUNK_OVERLAP_CHARS,

        start +
          1,
      );
  }


  return chunks;
}


function buildEmbeddingText(
  title:
    string |
    null |
    undefined,

  content:
    string,
):
  string {

  const normalizedTitle =
    title?.trim() ??
    "";

  const normalizedContent =
    content.trim();

  if (
    !normalizedTitle
  ) {
    return normalizedContent;
  }

  return [
    `Title: ${normalizedTitle}`,
    `Content: ${normalizedContent}`,
  ].join("\n");
}

/*
 * --------------------------------------------------
 * Create deterministic Vectorize ID
 * --------------------------------------------------
 */

function createVectorId(
  documentId:
    string,

  chunkIndex:
    number,
):
  string {

  return `${documentId}:chunk:${chunkIndex}`;
}


/*
 * --------------------------------------------------
 * Knowledge index reconciliation result
 * --------------------------------------------------
 */

export interface KnowledgeIndexReconciliationResult {

  tenantId:
    string;

  documentId:
    string;

  action:
    | "create"
    | "update"
    | "delete"
    | "noop";

  chunksIndexed:
    number;

  vectorsDeleted:
    number;

  vectorizeMutations:
    string[];
}


/*
 * --------------------------------------------------
 * Resolve reserved AI instruction Knowledge Sources
 * --------------------------------------------------
 *
 * The authoritative Knowledge Base name is stored in:
 *
 *     knowledge_sources.name
 *
 * Documents only store knowledgeSourceId, so we resolve
 * the parent source here.
 * --------------------------------------------------
 */

async function resolveAIInstructionKnowledgeSourceIds(
  db:
    D1Database,

  documents:
    Array<
      KnowledgeDocumentRecord |
      null
    >,
):
  Promise<
    Set<string>
  > {

  const sourceIds =
    Array.from(
      new Set(
        documents
          .map(
            (
              document,
            ) =>
              document?.knowledgeSourceId,
          )
          .filter(
            (
              value,
            ): value is string =>
              Boolean(
                value?.trim(),
              ),
          ),
      ),
    );


  if (
    sourceIds.length ===
    0
  ) {

    return new Set<string>();
  }


  const sourceRepository =
    new KnowledgeSourceRepository(
      db,
    );


  const sources =
    await Promise.all(
      sourceIds.map(
        (
          sourceId,
        ) =>
          sourceRepository.findById(
            sourceId,
          ),
      ),
    );


  const aiInstructionSourceIds =
    new Set<string>();


  for (
    const source of
      sources
  ) {

    if (
      source &&

      source.status ===
        "active" &&

      isAIAgentInstructionsKnowledgeBase(
        source.name,
      )
    ) {

      aiInstructionSourceIds.add(
        source.id,
      );
    }
  }


  return aiInstructionSourceIds;
}


/*
 * --------------------------------------------------
 * Determine whether a document belongs in Vectorize
 * --------------------------------------------------
 *
 * Normal rule:
 *
 *     active + usable content
 *         -> searchable RAG knowledge
 *
 * ONLY exception:
 *
 *     AI Agent Instructions Knowledge Base
 *     +
 *     rich_text
 *
 *         -> deterministic AI instructions
 *         -> NOT normal RAG
 *
 * There is intentionally no source-type whitelist.
 * --------------------------------------------------
 */

function isIndexableKnowledgeDocument(
  document:
    KnowledgeDocumentRecord |
    null,

  aiInstructionKnowledgeSourceIds:
    Set<string>,
):
  boolean {

  if (
    !document
  ) {

    return false;
  }


  /*
   * ------------------------------------------------
   * Only active documents are searchable.
   * ------------------------------------------------
   */

  if (
    document.status !==
    "active"
  ) {

    return false;
  }


  /*
   * ------------------------------------------------
   * The document must contain actual usable content.
   * ------------------------------------------------
   */

  if (
    typeof document.content !==
      "string" ||

    document.content
      .trim()
      .length ===
      0
  ) {

    return false;
  }


  /*
   * ------------------------------------------------
   * ONLY RESERVED EXCEPTION
   * ------------------------------------------------
   *
   * Rich Text inside the Knowledge Base named
   * "AI Agent Instructions" is handled by the
   * deterministic AI instruction loader.
   *
   * It must never enter the normal RAG index.
   * ------------------------------------------------
   */

  if (
    document.sourceType ===
      "rich_text" &&

    aiInstructionKnowledgeSourceIds.has(
      document.knowledgeSourceId,
    )
  ) {

    return false;
  }


  /*
   * ------------------------------------------------
   * EVERYTHING ELSE WITH CONTENT IS RAG KNOWLEDGE
   * ------------------------------------------------
   *
   * No hard-coded source-type whitelist.
   *
   * This allows:
   *
   * - faq
   * - website
   * - rich_text
   * - file
   * - table
   * - table_file
   * - trained_url
   * - other future provider document types
   *
   * provided that the provider has supplied usable
   * content into knowledge_documents.content.
   * ------------------------------------------------
   */

  return true;
}


/*
 * --------------------------------------------------
 * Reconcile one knowledge document in Vectorize
 * --------------------------------------------------
 */

export async function reconcileKnowledgeDocumentIndex(
  db:
    D1Database,

  ai:
    Ai,

  vectorize:
    Vectorize,

  tenantId:
    string,

  previousDocument:
    KnowledgeDocumentRecord |
    null,

  currentDocument:
    KnowledgeDocumentRecord |
    null,
):
  Promise<
    KnowledgeIndexReconciliationResult
  > {

  /*
   * ------------------------------------------------
   * 1. Resolve parent Knowledge Base classification
   * ------------------------------------------------
   */

  const aiInstructionKnowledgeSourceIds =
    await resolveAIInstructionKnowledgeSourceIds(
      db,

      [
        previousDocument,

        currentDocument,
      ],
    );


  /*
   * ------------------------------------------------
   * 2. Resolve document state
   * ------------------------------------------------
   */

  const currentIsIndexable =
    isIndexableKnowledgeDocument(
      currentDocument,

      aiInstructionKnowledgeSourceIds,
    );


  const previousIsIndexable =
    isIndexableKnowledgeDocument(
      previousDocument,

      aiInstructionKnowledgeSourceIds,
    );


  /*
   * ------------------------------------------------
   * 3. Determine reconciliation action
   * ------------------------------------------------
   */

  let action:
    | "create"
    | "update"
    | "delete"
    | "noop";


  if (
    !previousIsIndexable &&
    currentIsIndexable
  ) {

    action =
      "create";

  } else if (
    previousIsIndexable &&
    currentIsIndexable
  ) {

    action =
      "update";

  } else if (
    previousIsIndexable &&
    !currentIsIndexable
  ) {

    action =
      "delete";

  } else {

    action =
      "noop";
  }


  /*
   * ------------------------------------------------
   * 4. Resolve chunks
   * ------------------------------------------------
   */

  const previousChunks =
    previousIsIndexable
      ? chunkContent(
          previousDocument!
            .content!,
        )
      : [];


  const currentChunks =
    currentIsIndexable
      ? chunkContent(
          currentDocument!
            .content!,
        )
      : [];


  const vectorizeMutations:
    string[] = [];


  let chunksIndexed =
    0;


  let vectorsDeleted =
    0;


  /*
   * ------------------------------------------------
   * 5. Upsert current vectors
   * ------------------------------------------------
   */

  if (
    currentIsIndexable &&
    currentDocument
  ) {

    const texts =
      currentChunks.map(
        (
          chunk,
        ) =>
          buildEmbeddingText(
            currentDocument.title,
            chunk.content,
          ),
      );


    if (
      texts.length >
      0
    ) {

      const embeddingResult =
        await createKnowledgeEmbeddings(
          ai,

          texts,
        );


      const vectors =
        currentChunks.map(
          (
            chunk,

            position,
          ) => ({

            id:
              createVectorId(
                currentDocument.id,

                chunk.index,
              ),

            namespace:
              tenantId,

            values:
              embeddingResult
                .vectors[
                  position
                ],

            metadata: {

              tenantId,

              provider:
                currentDocument.provider,

              sourceType:
                currentDocument.sourceType,

              knowledgeSourceId:
                currentDocument.knowledgeSourceId,

              providerDocumentId:
                currentDocument.providerDocumentId,

              title:
                currentDocument.title ??
                "",

              chunkIndex:
                chunk.index,

              content:
                chunk.content,
            },
          }),
        );


      if (
        vectors.length >
        0
      ) {

        const mutation =
          await vectorize.upsert(
            vectors,
          );


        if (
          mutation.mutationId
        ) {

          vectorizeMutations.push(
            mutation.mutationId,
          );
        }


        chunksIndexed =
          vectors.length;
      }
    }
  }


  /*
   * ------------------------------------------------
   * 6. Resolve obsolete vector IDs
   * ------------------------------------------------
   */

  const obsoleteVectorIds:
    string[] = [];


  if (
    previousIsIndexable &&
    previousDocument
  ) {

    /*
     * ----------------------------------------------
     * Document identity changed or document vanished
     * ----------------------------------------------
     */

    if (
      !currentDocument ||

      currentDocument.id !==
        previousDocument.id
    ) {

      for (
        const chunk of
          previousChunks
      ) {

        obsoleteVectorIds.push(
          createVectorId(
            previousDocument.id,

            chunk.index,
          ),
        );
      }

    } else {

      /*
       * --------------------------------------------
       * Same document ID
       * --------------------------------------------
       *
       * Remove chunks that disappeared because the
       * updated document became shorter.
       */

      if (
        previousChunks.length >
        currentChunks.length
      ) {

        for (
          let index =
            currentChunks.length;

          index <
            previousChunks.length;

          index +=
            1
        ) {

          obsoleteVectorIds.push(
            createVectorId(
              previousDocument.id,

              index,
            ),
          );
        }
      }
    }
  }


  /*
   * ------------------------------------------------
   * 7. Delete obsolete vectors
   * ------------------------------------------------
   */

  if (
    obsoleteVectorIds.length >
    0
  ) {

    const mutation =
      await vectorize.deleteByIds(
        obsoleteVectorIds,
      );


    if (
      mutation.mutationId
    ) {

      vectorizeMutations.push(
        mutation.mutationId,
      );
    }


    vectorsDeleted =
      obsoleteVectorIds.length;
  }


  /*
   * ------------------------------------------------
   * 8. Return reconciliation result
   * ------------------------------------------------
   */

  return {

    tenantId,

    documentId:
      currentDocument?.id ??
      previousDocument?.id ??
      "",

    action,

    chunksIndexed,

    vectorsDeleted,

    vectorizeMutations,
  };
}


/*
 * --------------------------------------------------
 * Index all knowledge for one tenant
 * --------------------------------------------------
 */

export async function indexKnowledgeForTenant(
  db:
    D1Database,

  ai:
    Ai,

  vectorize:
    Vectorize,

  tenantId:
    string,
):
  Promise<
    KnowledgeIndexResult
  > {

  /*
   * ------------------------------------------------
   * 1. Load synchronized knowledge documents
   * ------------------------------------------------
   */

  const repository =
    new KnowledgeDocumentRepository(
      db,
    );


  const documents =
    await repository.findByTenant(
      tenantId,
    );


  /*
   * ------------------------------------------------
   * 2. Resolve reserved AI instruction sources
   * ------------------------------------------------
   */

  const aiInstructionKnowledgeSourceIds =
    await resolveAIInstructionKnowledgeSourceIds(
      db,

      documents,
    );


  /*
   * ------------------------------------------------
   * 3. Identify active AI instruction documents
   * ------------------------------------------------
   *
   * These are NOT normal RAG knowledge.
   *
   * Their vectors are removed in case the document was
   * previously indexed before its Knowledge Base became
   * "AI Agent Instructions".
   * ------------------------------------------------
   */

  const instructionDocuments =
    documents.filter(
      (
        document,
      ) =>

        document.status ===
          "active" &&

        document.sourceType ===
          "rich_text" &&

        aiInstructionKnowledgeSourceIds.has(
          document.knowledgeSourceId,
        ) &&

        typeof document.content ===
          "string" &&

        document.content
          .trim()
          .length >
          0,
    );


  /*
   * ------------------------------------------------
   * 4. Select ALL normal searchable documents
   * ------------------------------------------------
   */

  const indexableDocuments =
    documents.filter(
      (
        document,
      ) =>
        isIndexableKnowledgeDocument(
          document,

          aiInstructionKnowledgeSourceIds,
        ),
    );


  let documentsIndexed =
    0;


  let chunksIndexed =
    0;


  const skippedDocuments =
    documents.length -
    indexableDocuments.length;


  console.log(
    "Knowledge Vectorize selection",
    {

      tenantId,

      totalDocuments:
        documents.length,

      indexableDocuments:
        indexableDocuments.length,

      skippedDocuments,

      aiInstructionKnowledgeSources:
        Array.from(
          aiInstructionKnowledgeSourceIds,
        ),

    },
  );


  const vectorizeMutations:
    string[] = [];


  /*
   * ------------------------------------------------
   * 5. Remove vectors belonging to AI instructions
   * ------------------------------------------------
   */

  for (
    const document of
      instructionDocuments
  ) {

    const chunks =
      chunkContent(
        document.content!,
      );


    if (
      chunks.length ===
      0
    ) {

      continue;
    }


    const vectorIds =
      chunks.map(
        (
          chunk,
        ) =>
          createVectorId(
            document.id,

            chunk.index,
          ),
      );


    const mutation =
      await vectorize.deleteByIds(
        vectorIds,
      );


    if (
      mutation.mutationId
    ) {

      vectorizeMutations.push(
        mutation.mutationId,
      );
    }


    console.log(
      "Knowledge Vectorize removed AI instruction vectors",
      {

        tenantId,

        documentId:
          document.id,

        knowledgeSourceId:
          document.knowledgeSourceId,

        vectorCount:
          vectorIds.length,

        mutationId:
          mutation.mutationId,
      },
    );
  }


  /*
   * ------------------------------------------------
   * 6. Index each normal knowledge document
   * ------------------------------------------------
   */

  for (
    const document of
      indexableDocuments
  ) {

    console.log(
      "Knowledge Vectorize index decision",
      {

        tenantId,

        documentId:
          document.id,

        providerDocumentId:
          document.providerDocumentId,

        sourceType:
          document.sourceType,

        knowledgeSourceId:
          document.knowledgeSourceId,

        indexable:
          true,
      },
    );


    /*
     * ----------------------------------------------
     * 6A. Chunk document
     * ----------------------------------------------
     */

    const chunks =
      chunkContent(
        document.content!,
      );


    if (
      chunks.length ===
      0
    ) {

      continue;
    }


    /*
     * ----------------------------------------------
     * 6B. Prepare embedding input
     * ----------------------------------------------
     */

    const texts =
      chunks.map(
        (
          chunk,
        ) =>
          buildEmbeddingText(
            document.title,
            chunk.content,
          ),
      );


    /*
     * ----------------------------------------------
     * 6C. Generate embeddings
     * ----------------------------------------------
     */

    const embeddingResult =
      await createKnowledgeEmbeddings(
        ai,

        texts,
      );


    /*
     * ----------------------------------------------
     * 6D. Build Vectorize vectors
     * ----------------------------------------------
     */

    const vectors =
      chunks.map(
        (
          chunk,

          position,
        ) => ({

          id:
            createVectorId(
              document.id,

              chunk.index,
            ),

          namespace:
            tenantId,

          values:
            embeddingResult
              .vectors[
                position
              ],

          metadata: {

            tenantId,

            provider:
              document.provider,

            sourceType:
              document.sourceType,

            knowledgeSourceId:
              document.knowledgeSourceId,

            providerDocumentId:
              document.providerDocumentId,

            title:
              document.title ??
              "",

            chunkIndex:
              chunk.index,

            content:
              chunk.content,
          },

        }),
      );


    /*
     * ----------------------------------------------
     * 6E. Upsert into Vectorize
     * ----------------------------------------------
     */

    const mutation =
      await vectorize.upsert(
        vectors,
      );


    /*
     * ----------------------------------------------
     * 6F. Capture mutation ID
     * ----------------------------------------------
     */

    if (
      mutation.mutationId
    ) {

      vectorizeMutations.push(
        mutation.mutationId,
      );
    }


    /*
     * ----------------------------------------------
     * 6G. Diagnostic logging
     * ----------------------------------------------
     */

    console.log(
      "Knowledge Vectorize upsert",
      {

        tenantId,

        documentId:
          document.id,

        providerDocumentId:
          document.providerDocumentId,

        sourceType:
          document.sourceType,

        knowledgeSourceId:
          document.knowledgeSourceId,

        vectorCount:
          vectors.length,

        mutationId:
          mutation.mutationId,
      },
    );


    /*
     * ----------------------------------------------
     * 6H. Update result counters
     * ----------------------------------------------
     */

    documentsIndexed +=
      1;


    chunksIndexed +=
      vectors.length;
  }


  /*
   * ------------------------------------------------
   * 7. Return indexing result
   * ------------------------------------------------
   */

  return {

    tenantId,

    documentsIndexed,

    chunksIndexed,

    skippedDocuments,

    vectorizeMutations,
  };
}