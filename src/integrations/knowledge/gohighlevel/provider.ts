import type {
  KnowledgeBase,
  KnowledgeContext,
  KnowledgeDocument,
  KnowledgeProvider,
  KnowledgeSyncRequest,
} from "../../../core/knowledge";

import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";

import type {
  IntegrationContext,
} from "../../../context/integration";


/*
 * --------------------------------------------------
 * GHL Knowledge Base
 * --------------------------------------------------
 */

interface GHLKnowledgeBaseMetadata {

  faqs?:
    number;

  urls?:
    number;

  richText?:
    number;

  files?:
    number;

  webSearches?:
    number;

  tables?:
    number;

  [key:
    string]:
    unknown;
}


interface GHLKnowledgeBaseRecord {

  id:
    string;

  name?:
    string;

  description?:
    string;

  createdAt?:
    string;

  updatedAt?:
    string;

  deleted?:
    boolean;

  isDefault?:
    boolean;

  kbMetadata?:
    GHLKnowledgeBaseMetadata;

  [key:
    string]:
    unknown;
}


interface GHLKnowledgeBaseListResponse {

  success?:
    boolean;

  data?: {

    knowledgeBases?:
      GHLKnowledgeBaseRecord[];

    activeCount?:
      number;

    hasMore?:
      boolean;

    lastKnowledgeBaseId?:
      string;

    [key:
      string]:
      unknown;
  };

  traceId?:
    string;
}


interface GHLKnowledgeBaseDetailResponse {

  success?:
    boolean;

  data?:
    GHLKnowledgeBaseRecord;

  traceId?:
    string;
}


/*
 * --------------------------------------------------
 * GHL FAQ
 * --------------------------------------------------
 */

interface GHLFaqRecord {

  id:
    string;

  question:
    string;

  answer:
    string;

  questionLowerCase?:
    string;

  knowledgeBaseId?:
    string;

  locationId?:
    string;

  trainedUrlId?:
    string;

  deleted?:
    boolean;

  createdAt?:
    string;

  updatedAt?:
    string;

  [key:
    string]:
    unknown;
}


interface GHLFaqListResponse {

  count?:
    number;

  faqs?:
    GHLFaqRecord[];

  lastFaqId?:
    string;

  hasMore?:
    boolean;

  traceId?:
    string;
}


/*
 * --------------------------------------------------
 * GHL Trained Website URL
 * --------------------------------------------------
 */

interface GHLTrainedUrlRecord {

  id:
    string;

  url:
    string;

  content?:
    string;

  title?:
    string;

  locationId?:
    string;

  knowledgeBaseId?:
    string;

  status?:
    string;

  contentEditedByUser?:
    boolean;

  automatedRefreshCount?:
    number;

  updatedAt?:
    string;

  trainingCompletedAt?:
    string;

  deleted?:
    boolean;

  [key:
    string]:
    unknown;
}


interface GHLTrainedUrlListResponse {

  count:
    number;

  urls:
    GHLTrainedUrlRecord[];

  traceId?:
    string;
}


/*
 * --------------------------------------------------
 * GHL Rich Text
 * --------------------------------------------------
 */

interface GHLRichTextRecord {

  id:
    string;

  title?:
    string;

  locationId?:
    string;

  knowledgeBaseId?:
    string;

  deleted?:
    boolean;

  createdAt?:
    string;

  updatedAt?:
    string;

  status?:
    string;

  contentMarkdown?:
    string;

  content?:
    string;

  [key:
    string]:
    unknown;
}


interface GHLRichTextListResponse {

  success?:
    boolean;

  data?:
    GHLRichTextRecord[];

  traceId?:
    string;
}


/*
 * --------------------------------------------------
 * GHL Knowledge Base File
 * --------------------------------------------------
 *
 * HighLevel documents:
 *
 * GET /knowledge-bases/files
 * GET /knowledge-bases/files/:fileId
 *
 * The public response currently documents file
 * metadata. Depending on the account/runtime, the
 * response may expose one of several URL/content
 * fields. We inspect the returned object safely.
 * --------------------------------------------------
 */

interface GHLFileRecord {

  id:
    string;

  name?:
    string;

  locationId?:
    string;

  knowledgeBaseId?:
    string;

  size?:
    number;

  mimeType?:
    string;

  encoding?:
    string;

  status?:
    string;

  deleted?:
    boolean;

  createdAt?:
    string;

  updatedAt?:
    string;

  url?:
    string;

  fileUrl?:
    string;

  contentUrl?:
    string;

  downloadUrl?:
    string;

  publicUrl?:
    string;

  textUrl?:
    string;

  content?:
    string;

  text?:
    string;

  extractedText?:
    string;

  [key:
    string]:
    unknown;
}


interface GHLFileListResponse {

  success?:
    boolean;

  data?: {

    files?:
      GHLFileRecord[];

    count?:
      number;

    hasMore?:
      boolean;

    lastFileId?:
      string;

    [key:
      string]:
      unknown;
  };

  /*
   * Some older response shapes expose files at the
   * top level.
   */

  files?:
    GHLFileRecord[];

  count?:
    number;

  hasMore?:
    boolean;

  lastFileId?:
    string;

  traceId?:
    string;
}


interface GHLFileDetailResponse {

  success?:
    boolean;

  data?:
    GHLFileRecord;

  traceId?:
    string;
}


/*
 * --------------------------------------------------
 * Generic helper
 * --------------------------------------------------
 */

function getStringField(
  record:
    Record<string, unknown>,

  keys:
    string[],
):
  string |
  undefined {

  for (
    const key of
      keys
  ) {

    const value =
      record[key];


    if (
      typeof value ===
      "string" &&
      value.trim()
    ) {

      return value.trim();
    }
  }


  return undefined;
}


/*
 * --------------------------------------------------
 * Resolve Knowledge Base source types
 * --------------------------------------------------
 */

function resolveSourceTypes(
  metadata:
    GHLKnowledgeBaseMetadata |
    undefined,
):
  Array<
    | "faq"
    | "file"
    | "website"
    | "rich_text"
    | "table"
    | "unknown"
  > {

  if (
    !metadata
  ) {

    return [
      "unknown",
    ];
  }


  const sourceTypes:
    Array<
      | "faq"
      | "file"
      | "website"
      | "rich_text"
      | "table"
      | "unknown"
    > = [];


  if (
    (metadata.faqs ?? 0) >
    0
  ) {

    sourceTypes.push(
      "faq",
    );
  }


  if (
    (metadata.files ?? 0) >
    0
  ) {

    sourceTypes.push(
      "file",
    );
  }


  if (
    (metadata.urls ?? 0) >
    0
  ) {

    sourceTypes.push(
      "website",
    );
  }


  if (
    (metadata.richText ?? 0) >
    0
  ) {

    sourceTypes.push(
      "rich_text",
    );
  }


  if (
    (metadata.tables ?? 0) >
    0
  ) {

    sourceTypes.push(
      "table",
    );
  }


  /*
   * Web searches are not treated as a persisted
   * knowledge-document source unless GHL exposes actual
   * content through a dedicated document API.
   *
   * We deliberately do not invent a source type for it.
   */


  if (
    sourceTypes.length ===
    0
  ) {

    sourceTypes.push(
      "unknown",
    );
  }


  return sourceTypes;
}


/*
 * --------------------------------------------------
 * Map Knowledge Base
 * --------------------------------------------------
 */

function mapKnowledgeBase(
  context:
    KnowledgeContext,

  record:
    GHLKnowledgeBaseRecord,
):
  KnowledgeBase {

  return {

    id:
      `gohighlevel:${record.id}`,

    tenantId:
      context.tenant.id,

    provider:
      "gohighlevel",

    providerKnowledgeBaseId:
      record.id,

    name:
      typeof record.name ===
      "string"
        ? record.name
        : record.id,

    description:
      typeof record.description ===
      "string"
        ? record.description
        : undefined,

    sourceTypes:
      resolveSourceTypes(
        record.kbMetadata,
      ),

    createdAt:
      typeof record.createdAt ===
      "string"
        ? record.createdAt
        : undefined,

    updatedAt:
      typeof record.updatedAt ===
      "string"
        ? record.updatedAt
        : undefined,
  };
}


/*
 * --------------------------------------------------
 * Map FAQ
 * --------------------------------------------------
 */

function mapFaq(
  context:
    KnowledgeContext,

  record:
    GHLFaqRecord,
):
  KnowledgeDocument {

  return {

    id:
      `gohighlevel:faq:${record.id}`,

    tenantId:
      context.tenant.id,

    provider:
      "gohighlevel",

    providerDocumentId:
      record.id,

    knowledgeBaseId:
      record.knowledgeBaseId ??
      "",

    sourceType:
      "faq",

    title:
      record.question,

    content:
      `Question: ${record.question}\n\nAnswer: ${record.answer}`,

    metadata: {

      question:
        record.question,

      answer:
        record.answer,

      questionLowerCase:
        record.questionLowerCase ??
        null,

      locationId:
        record.locationId ??
        null,

      trainedUrlId:
        record.trainedUrlId ??
        null,

      deleted:
        record.deleted ??
        false,
    },

    createdAt:
      typeof record.createdAt ===
      "string"
        ? record.createdAt
        : undefined,

    updatedAt:
      typeof record.updatedAt ===
      "string"
        ? record.updatedAt
        : undefined,
  };
}


/*
 * --------------------------------------------------
 * Clean HTML / rich-text content
 * --------------------------------------------------
 */

function cleanRichTextContent(
  rawContent:
    string,
):
  string {

  return rawContent

    .replace(
      /<br\s*\/?>/giu,
      "\n",
    )

    .replace(
      /<\/p>/giu,
      "\n\n",
    )

    .replace(
      /<\/div>/giu,
      "\n",
    )

    .replace(
      /<\/li>/giu,
      "\n",
    )

    .replace(
      /<[^>]+>/gu,
      "",
    )

    .replace(
      /&nbsp;/giu,
      " ",
    )

    .replace(
      /&amp;/giu,
      "&",
    )

    .replace(
      /&lt;/giu,
      "<",
    )

    .replace(
      /&gt;/giu,
      ">",
    )

    .replace(
      /&#39;/giu,
      "'",
    )

    .replace(
      /&quot;/giu,
      '"',
    )

    .replace(
      /\n{3,}/gu,
      "\n\n",
    )

    .trim();
}


/*
 * --------------------------------------------------
 * Map Rich Text
 * --------------------------------------------------
 */

function mapRichText(
  context:
    KnowledgeContext,

  record:
    GHLRichTextRecord,
):
  KnowledgeDocument {

  const rawContent =
    record.contentMarkdown?.trim() ||
    record.content?.trim() ||
    "";


  const content =
    cleanRichTextContent(
      rawContent,
    );


  return {

    id:
      `gohighlevel:rich_text:${record.id}`,

    tenantId:
      context.tenant.id,

    provider:
      "gohighlevel",

    providerDocumentId:
      record.id,

    knowledgeBaseId:
      record.knowledgeBaseId ??
      "",

    sourceType:
      "rich_text",

    title:
      record.title ??
      record.id,

    content,

    mimeType:
      record.contentMarkdown
        ? "text/markdown"
        : "text/html",

    metadata: {

      locationId:
        record.locationId ??
        null,

      status:
        record.status ??
        null,

      deleted:
        record.deleted ??
        false,

      contentMarkdown:
        record.contentMarkdown ??
        null,
    },

    createdAt:
      typeof record.createdAt ===
      "string"
        ? record.createdAt
        : undefined,

    updatedAt:
      typeof record.updatedAt ===
      "string"
        ? record.updatedAt
        : undefined,
  };
}

function createGHLKnowledgeContext(
  context:
    KnowledgeContext,
):
  IntegrationContext {

  return {

    tenant:
      context.tenant,

    provider:
      "gohighlevel",

    requestId:
      context.requestId,

    receivedAt:
      context.receivedAt,

    integrationRuntime:
      context.integrationRuntime,
  };
}


function resolveKnowledgeLocationId(
  context:
    KnowledgeContext,
):
  string {

  const locationId =
    context
      .tenant
      .integrations
      .crm
      .credentials
      .locationId
      ?.trim() ??
    "";

  if (
    !locationId
  ) {

    throw new Error(
      "GoHighLevel locationId is required for Knowledge API access.",
    );
  }

  return locationId;
}

/*
 * --------------------------------------------------
 * Fetch Rich Text assets for one Knowledge Base
 * --------------------------------------------------
 */

async function fetchRichTextRecords(
  context:
    KnowledgeContext,

  knowledgeBaseId:
    string,
):
  Promise<
    GHLRichTextRecord[]
  > {

  const response =
    await ghlFetchAuthenticated<
      GHLRichTextListResponse
    >(
      createGHLKnowledgeContext(
        context,
      ),

      `/knowledge-bases/rich-text/knowledge-base/${encodeURIComponent(
        knowledgeBaseId,
      )}`,
    );


  return (
    response.data
      ?.filter(
        (
          record,
        ) =>
          record.deleted !==
          true,
      )

      ??
      []
  );
}


/*
 * --------------------------------------------------
 * Fetch trained URL content
 * --------------------------------------------------
 */

async function fetchTrainedUrlContent(
  contentUrl:
    string,
):
  Promise<string> {

  const response =
    await fetch(
      contentUrl,
      {
        method:
          "GET",

        headers: {

          Accept:
            "text/plain,*/*",
        },
      },
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Failed to fetch GoHighLevel trained URL content: ${response.status}`,
    );
  }


  return response.text();
}


/*
 * --------------------------------------------------
 * Map trained website URL
 * --------------------------------------------------
 */

async function mapTrainedUrl(
  context:
    KnowledgeContext,

  record:
    GHLTrainedUrlRecord,
):
  Promise<
    KnowledgeDocument |
    null
  > {

  if (
    record.deleted ===
    true
  ) {

    return null;
  }


  if (
    !record.content
  ) {

    return null;
  }


  if (
    record.status !==
    "Successful"
  ) {

    return null;
  }


  const content =
    await fetchTrainedUrlContent(
      record.content,
    );


  if (
    !content.trim()
  ) {

    return null;
  }


  return {

    id:
      `gohighlevel:website:${record.id}`,

    tenantId:
      context.tenant.id,

    provider:
      "gohighlevel",

    providerDocumentId:
      record.id,

    knowledgeBaseId:
      record.knowledgeBaseId ??
      "",

    sourceType:
      "website",

    title:
      record.title ??
      record.url,

    content:
      content.trim(),

    sourceUrl:
      record.url,

    mimeType:
      "text/plain",

    metadata: {

      url:
        record.url,

      status:
        record.status ??
        null,

      locationId:
        record.locationId ??
        null,

      contentEditedByUser:
        record.contentEditedByUser ??
        false,

      automatedRefreshCount:
        record.automatedRefreshCount ??
        0,

      trainingCompletedAt:
        record.trainingCompletedAt ??
        null,

      contentUrl:
        record.content,
    },

    updatedAt:
      typeof record.updatedAt ===
      "string"
        ? record.updatedAt
        : undefined,
  };
}


/*
 * --------------------------------------------------
 * Resolve a possible file content URL
 * --------------------------------------------------
 */

function resolveFileContentUrl(
  record:
    GHLFileRecord,
):
  string |
  undefined {

  const source =
    record as Record<
      string,
      unknown
    >;


  return getStringField(
    source,

    [
      "contentUrl",
      "textUrl",
      "extractedTextUrl",
      "fileUrl",
      "downloadUrl",
      "publicUrl",
      "url",
    ],
  );
}


/*
 * --------------------------------------------------
 * Resolve inline file text
 * --------------------------------------------------
 */

function resolveInlineFileContent(
  record:
    GHLFileRecord,
):
  string |
  undefined {

  const source =
    record as Record<
      string,
      unknown
    >;


  const content =
    getStringField(
      source,

      [
        "content",
        "text",
        "textContent",
        "extractedText",
        "parsedText",
        "plainText",
      ],
    );


  if (
    content
  ) {

    return content;
  }


  return undefined;
}


/*
 * --------------------------------------------------
 * Fetch remote file content
 * --------------------------------------------------
 *
 * We only accept textual responses here.
 *
 * PDF/DOC/DOCX binary parsing should not be faked.
 * The GHL API documentation exposes file metadata
 * through the file endpoint; if the response also
 * exposes an extracted/text URL we can consume it.
 * --------------------------------------------------
 */

async function fetchFileTextFromUrl(
  url:
    string,
):
  Promise<string | null> {

  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {

          Accept:
            "text/plain,text/html,application/json,*/*",
        },
      },
    );


  if (
    !response.ok
  ) {

    console.warn(
      "GHL knowledge file content fetch failed",
      {
        url,
        status:
          response.status,
      },
    );


    return null;
  }


  const contentType =
    response.headers
      .get(
        "content-type",
      )
      ?.toLowerCase() ??
    "";


  /*
   * Only safely ingest textual content.
   */

  const isTextual =
    contentType.includes(
      "text/",
    ) ||

    contentType.includes(
      "application/json",
    ) ||

    contentType.includes(
      "application/xml",
    ) ||

    contentType.includes(
      "application/octet-stream",
    ) ===
      false;


  if (
    !isTextual
  ) {

    console.warn(
      "GHL knowledge file is binary and no safe text extraction path is available",
      {
        url,

        contentType,
      },
    );


    return null;
  }


  const text =
    await response.text();


  return text.trim() ||
    null;
}


/*
 * --------------------------------------------------
 * Map Knowledge Base File
 * --------------------------------------------------
 */

async function mapFile(
  context:
    KnowledgeContext,

  record:
    GHLFileRecord,
):
  Promise<
    KnowledgeDocument |
    null
  > {

  if (
    record.deleted ===
    true
  ) {

    return null;
  }


  const status =
    record.status
      ?.trim()
      .toLowerCase() ??
    "";


  /*
   * Do not index files which are explicitly failed or
   * still being uploaded/trained.
   *
   * A missing status remains acceptable because some
   * GHL responses may omit it.
   */

  if (
    status ===
      "failed" ||

    status ===
      "deleted" ||

    status ===
      "uploading"
  ) {

    return null;
  }


  const inlineContent =
    resolveInlineFileContent(
      record,
    );


  let content =
    inlineContent ??
    "";


  const contentUrl =
    resolveFileContentUrl(
      record,
    );


  /*
   * If the response directly exposes a URL and no
   * inline text, attempt to retrieve textual content.
   */

  if (
    !content &&
    contentUrl
  ) {

    content =
      await fetchFileTextFromUrl(
        contentUrl,
      ) ??
      "";
  }


  /*
   * ------------------------------------------------
   * We never create a fake document containing only
   * the filename.
   * ------------------------------------------------
   *
   * If GHL exposes metadata but no textual/extracted
   * content, skip it from KnowledgeDocument indexing.
   */

  if (
    !content.trim()
  ) {

    console.warn(
      "GHL knowledge file discovered without retrievable text content",
      {

        tenantId:
          context.tenant.id,

        knowledgeBaseId:
          record.knowledgeBaseId ??
          "",

        fileId:
          record.id,

        name:
          record.name ??
          record.id,

        mimeType:
          record.mimeType ??
          null,

        status:
          record.status ??
          null,

        contentUrl:
          contentUrl ??
          null,
      },
    );


    return null;
  }


  return {

    id:
      `gohighlevel:file:${record.id}`,

    tenantId:
      context.tenant.id,

    provider:
      "gohighlevel",

    providerDocumentId:
      record.id,

    knowledgeBaseId:
      record.knowledgeBaseId ??
      "",

    sourceType:
      "file",

    title:
      record.name ??
      record.id,

    content:
      content.trim(),

    sourceUrl:
      contentUrl,

    mimeType:
      record.mimeType ??
      undefined,

    metadata: {

      locationId:
        record.locationId ??
        null,

      status:
        record.status ??
        null,

      size:
        record.size ??
        null,

      encoding:
        record.encoding ??
        null,

      contentUrl:
        contentUrl ??
        null,

      deleted:
        record.deleted ??
        false,
    },

    createdAt:
      typeof record.createdAt ===
      "string"
        ? record.createdAt
        : undefined,

    updatedAt:
      typeof record.updatedAt ===
      "string"
        ? record.updatedAt
        : undefined,
  };
}


/*
 * --------------------------------------------------
 * Extract file records from flexible GHL response
 * --------------------------------------------------
 */

function getFileRecords(
  response:
    GHLFileListResponse,
):
  GHLFileRecord[] {

  if (
    Array.isArray(
      response.data?.files,
    )
  ) {

    return response.data.files;
  }


  if (
    Array.isArray(
      response.files,
    )
  ) {

    return response.files;
  }


  return [];
}


/*
 * --------------------------------------------------
 * Fetch all file records for one Knowledge Base
 * --------------------------------------------------
 */

async function fetchFileRecords(
  context:
    KnowledgeContext,

  knowledgeBaseId:
    string,

  locationId:
    string,
):
  Promise<
    GHLFileRecord[]
  > {

  const records:
    GHLFileRecord[] = [];


  let lastFileId:
    string |
    undefined;


  let hasMore =
    true;


  while (
    hasMore
  ) {

    const params =
      new URLSearchParams({

        knowledgeBaseId,

        limit:
          "100",

        offset:
          "0",
      });


    /*
     * The documented API supports lastFileId
     * pagination.
     */

    if (
      lastFileId
    ) {

      params.set(
        "lastFileId",
        lastFileId,
      );
    }


    /*
     * The endpoint is location scoped through the
     * authenticated sub-account. Keep locationId in
     * the query when supported by the backend.
     */

    params.set(
      "locationId",
      locationId,
    );


    const response =
      await ghlFetchAuthenticated<
        GHLFileListResponse
      >(
        createGHLKnowledgeContext(
          context,
        ),

        `/knowledge-bases/files?${params.toString()}`,

        {
          headers: {

            Version:
              "v3",
          },
        },
      );


    const files =
      getFileRecords(
        response,
      );


    if (
      files.length >
      0
    ) {

      records.push(
        ...files.filter(
          (
            file,
          ) =>
            file.deleted !==
            true,
        ),
      );
    }


    hasMore =
      response.data?.hasMore ??
      response.hasMore ??
      false;


    lastFileId =
      response.data?.lastFileId ??
      response.lastFileId;


    if (
      hasMore &&
      !lastFileId
    ) {

      throw new Error(
        "GoHighLevel file pagination reported more results but did not return lastFileId.",
      );
    }


    /*
     * Defensive stop against a broken pagination
     * response repeating the same page.
     */

    if (
      hasMore &&
      files.length ===
      0
    ) {

      console.warn(
        "GHL file pagination returned hasMore=true with no files; stopping safely.",
        {
          knowledgeBaseId,
        },
      );


      break;
    }
  }


  return records;
}


/*
 * --------------------------------------------------
 * GoHighLevel Knowledge Provider
 * --------------------------------------------------
 */

export const goHighLevelKnowledgeProvider:
  KnowledgeProvider = {

  /*
   * ------------------------------------------------
   * List Knowledge Bases
   * ------------------------------------------------
   */

  async listKnowledgeBases(
    context:
      KnowledgeContext,
  ):
    Promise<
      KnowledgeBase[]
    > {

    const locationId =
  resolveKnowledgeLocationId(
    context,
  );

const ghlContext =
  createGHLKnowledgeContext(
    context,
  );


    const params =
      new URLSearchParams({

        locationId:
          locationId,

        limit:
          "20",
      });


        const response =
          await ghlFetchAuthenticated<
            GHLKnowledgeBaseListResponse
          >(
            ghlContext,

            `/knowledge-bases/?${params.toString()}`,

            {
              headers: {

                Version:
                  "v3",
              },
            },
          );

        const records =
          response.data
        ?.knowledgeBases
        ?.filter(
          (
            record,
          ) =>
            record.deleted !==
            true,
        ) ??
      [];


    const knowledgeBases:
      KnowledgeBase[] = [];


    /*
     * ------------------------------------------------
     * Resolve full metadata
     * ------------------------------------------------
     */

    for (
      const record of
        records
    ) {

      const detail =
        await ghlFetchAuthenticated<
          GHLKnowledgeBaseDetailResponse
        >(
          ghlContext,

          `/knowledge-bases/${record.id}`,

          {
            headers: {

              Version:
                "v3",
            },
          },
        );


      knowledgeBases.push(
        mapKnowledgeBase(
          context,

          {
            ...record,

            ...(detail.data ??
              {}),
          },
        ),
      );
    }


    return knowledgeBases;
  },


  /*
   * ------------------------------------------------
   * List Knowledge Documents
   * ------------------------------------------------
   *
   * Supported content paths:
   *
   * - FAQ
   * - Trained website URL
   * - Rich Text
   * - File (when text/extracted content is exposed)
   *
   * Table assets are recognized in Knowledge Base
   * metadata, but HighLevel's currently documented
   * public API does not expose a table-content retrieval
   * endpoint. We therefore do NOT invent one.
   * ------------------------------------------------
   */

  async listDocuments(
    context:
      KnowledgeContext,

    knowledgeBaseId:
      string,
  ):
    Promise<
      KnowledgeDocument[]
    > {

    const locationId =
        resolveKnowledgeLocationId(
          context,
        );

      const ghlContext =
        createGHLKnowledgeContext(
          context,
        );


    const documents:
      KnowledgeDocument[] = [];


    /*
     * ------------------------------------------------
     * FAQ documents
     * ------------------------------------------------
     */

    let lastFaqId:
      string |
      undefined;


    let hasMoreFaqs =
      true;


    while (
      hasMoreFaqs
    ) {

      const params =
        new URLSearchParams({

          knowledgeBaseId,

          locationId:
            locationId,

          limit:
            "100",

          offset:
            "0",
        });


      if (
        lastFaqId
      ) {

        params.set(
          "lastFaqId",
          lastFaqId,
        );
      }


      const response =
        await ghlFetchAuthenticated<
          GHLFaqListResponse
        >(
          ghlContext,

          `/knowledge-bases/faqs?${params.toString()}`,

          {
            headers: {

              Version:
                "v3",
            },
          },
        );


      const faqs =
        response.faqs ??
        [];


      documents.push(
        ...faqs

          .filter(
            (
              faq,
            ) =>
              faq.deleted !==
              true,
          )

          .map(
            (
              faq,
            ) =>
              mapFaq(
                context,
                faq,
              ),
          ),
      );


      hasMoreFaqs =
        response.hasMore ??
        false;


      lastFaqId =
        response.lastFaqId;


      if (
        hasMoreFaqs &&
        !lastFaqId
      ) {

        throw new Error(
          "GoHighLevel FAQ pagination reported more results but did not return lastFaqId.",
        );
      }
    }


    /*
     * ------------------------------------------------
     * Trained website documents
     * ------------------------------------------------
     */

    let page =
      1;


    const pageLength =
      20;


    let processedUrls =
      0;


    let totalUrls =
      Number.POSITIVE_INFINITY;


    while (
      processedUrls <
      totalUrls
    ) {

      const params =
        new URLSearchParams({

          knowledgeBaseId,

          locationId:
  locationId,

          page:
            String(
              page,
            ),

          pageLength:
            String(
              pageLength,
            ),
        });


      const response =
        await ghlFetchAuthenticated<
          GHLTrainedUrlListResponse
        >(
          ghlContext,

          `/knowledge-bases/crawler?${params.toString()}`,

          {
            headers: {

              Version:
                "2021-07-28",
            },
          },
        );


      totalUrls =
        response.count;


      const urls =
        response.urls ??
        [];


      if (
        urls.length ===
        0
      ) {

        break;
      }


      for (
        const urlRecord of
          urls
      ) {

        if (
          urlRecord.deleted ===
          true
        ) {

          continue;
        }


        if (
          urlRecord.status !==
          "Successful"
        ) {

          continue;
        }


        const document =
          await mapTrainedUrl(
            context,
            urlRecord,
          );


        if (
          document
        ) {

          documents.push(
            document,
          );
        }
      }


      processedUrls +=
        urls.length;


      if (
        urls.length <
        pageLength
      ) {

        break;
      }


      page +=
        1;
    }


    /*
     * ------------------------------------------------
     * Rich Text documents
     * ------------------------------------------------
     *
     * IMPORTANT:
     *
     * Rich Text is NOT automatically treated as AI
     * instructions here.
     *
     * The parent Knowledge Base name is resolved later
     * by the indexing / instruction layers.
     *
     * Therefore:
     *
     * AI Agent Instructions + rich_text
     *     -> deterministic instruction layer
     *
     * Any other KB + rich_text
     *     -> normal searchable knowledge
     * ------------------------------------------------
     */

    const richTextRecords =
      await fetchRichTextRecords(
        ghlContext,

        knowledgeBaseId,
      );


    documents.push(
      ...richTextRecords

        .filter(
          (
            record,
          ) =>
            record.deleted !==
            true &&

            (
              !record.status ||

              record.status ===
                "active" ||

              record.status ===
                "trained"
            ),
        )

        .map(
          (
            record,
          ) =>
            mapRichText(
              context,
              record,
            ),
        ),
    );


    /*
     * ------------------------------------------------
     * File documents
     * ------------------------------------------------
     */

    const fileRecords =
      await fetchFileRecords(
        context,

        knowledgeBaseId,

        locationId,
      );


    for (
      const fileRecord of
        fileRecords
    ) {

      const document =
        await mapFile(
          context,

          fileRecord,
        );


      if (
        document
      ) {

        documents.push(
          document,
        );
      }
    }


    /*
     * ------------------------------------------------
     * Table diagnostic
     * ------------------------------------------------
     *
     * HighLevel currently exposes table-file webhook
     * events, but the public content-retrieval API does
     * not document an endpoint returning table rows.
     *
     * We intentionally do not fabricate a URL or API
     * contract here.
     *
     * Once a real table content endpoint is available,
     * it can be added as another KnowledgeDocument mapper
     * without changing the indexing architecture.
     * ------------------------------------------------
     */

    const knowledgeBase =
      (
        await ghlFetchAuthenticated<
          GHLKnowledgeBaseDetailResponse
        >(
          ghlContext,

          `/knowledge-bases/${knowledgeBaseId}`,

          {
            headers: {

              Version:
                "v3",
            },
          },
        )
      ).data;


    const tableCount =
      Number(
        knowledgeBase
          ?.kbMetadata
          ?.tables ??
        0,
      );


    if (
      tableCount >
      0
    ) {

      console.warn(
        "GHL Knowledge Base contains table assets, but no documented table-content retrieval endpoint is available to the provider.",
        {

          knowledgeBaseId,

          tableCount,

        },
      );
    }


    /*
     * ------------------------------------------------
     * Deduplicate documents
     * ------------------------------------------------
     *
     * A provider update can occasionally surface the
     * same logical document through more than one path.
     */

    const deduplicated =
      new Map<
        string,
        KnowledgeDocument
      >();


    for (
      const document of
        documents
    ) {

      const key =
        [
          document.sourceType,

          document.providerDocumentId,
        ].join(
          ":",
        );


      deduplicated.set(
        key,
        document,
      );
    }


    return Array.from(
      deduplicated.values(),
    );
  },


  /*
   * ------------------------------------------------
   * Get one Knowledge Document
   * ------------------------------------------------
   *
   * The webhook incremental path now supports:
   *
   * - FAQ
   * - website / trained_url
   * - rich_text
   * - file
   *
   * Table content remains unsupported until GHL exposes
   * a documented retrieval API for table rows/content.
   * ------------------------------------------------
   */

  async getDocument(
    context:
      KnowledgeContext,

    request:
      KnowledgeSyncRequest,
  ):
    Promise<
      KnowledgeDocument |
      null
    > {

    if (
      request.deleted
    ) {

      return null;
    }


    if (
      !request.providerDocumentId
    ) {

      return null;
    }


    const locationId =
      resolveKnowledgeLocationId(
        context,
      );

    const ghlContext =
      createGHLKnowledgeContext(
        context,
      );


    /*
     * ------------------------------------------------
     * Rich Text
     * ------------------------------------------------
     */

    if (
      request.sourceType ===
      "rich_text"
    ) {

            const records =
        await fetchRichTextRecords(
          context,

          request.knowledgeBaseId,
        );

      const record =
        records.find(
          (
            item,
          ) =>
            item.id ===
            request.providerDocumentId,
        );

      if (
        !record
      ) {

        return null;
      }

           return mapRichText(
        context,

        record,
      );

    }

    /*
     * ------------------------------------------------
     * FAQ
     * ------------------------------------------------
     */

    if (
      request.sourceType ===
      "faq"
    ) {

      let lastFaqId:
        string |
        undefined;


      let hasMore =
        true;


      while (
        hasMore
      ) {

        const params =
          new URLSearchParams({

            knowledgeBaseId:
              request.knowledgeBaseId,

            locationId:
                locationId,

            limit:
              "100",

            offset:
              "0",
          });


        if (
          lastFaqId
        ) {

          params.set(
            "lastFaqId",
            lastFaqId,
          );
        }


        const response =
          await ghlFetchAuthenticated<
            GHLFaqListResponse
          >(
            ghlContext,

            `/knowledge-bases/faqs?${params.toString()}`,

            {
              headers: {

                Version:
                  "v3",
              },
            },
          );

        const record =
          (
            response.faqs ??
            []
          ).find(
            (
              item,
            ) =>
              item.id ===
              request.providerDocumentId,
          );


        if (
          record
        ) {

          return mapFaq(
            context,
            record,
          );
        }


        hasMore =
          response.hasMore ??
          false;


        lastFaqId =
          response.lastFaqId;


        if (
          hasMore &&
          !lastFaqId
        ) {

          break;
        }
      }


      return null;
    }


    /*
     * ------------------------------------------------
     * Website / trained URL
     * ------------------------------------------------
     */

    if (
      request.sourceType ===
      "website"
    ) {

      let page =
        1;


      const pageLength =
        20;


      let processed =
        0;


      let total =
        Number.POSITIVE_INFINITY;


      while (
        processed <
        total
      ) {

        const params =
          new URLSearchParams({

            knowledgeBaseId:
              request.knowledgeBaseId,

            locationId:
              locationId,

            page:
              String(
                page,
              ),

            pageLength:
              String(
                pageLength,
              ),
          });


        const response =
          await ghlFetchAuthenticated<
            GHLTrainedUrlListResponse
          >(
            ghlContext,

            `/knowledge-bases/crawler?${params.toString()}`,

            {
              headers: {

                Version:
                  "2021-07-28",
              },
            },
          );


        total =
          response.count;


        const record =
          (
            response.urls ??
            []
          ).find(
            (
              item,
            ) =>
              item.id ===
              request.providerDocumentId,
          );


        if (
          record
        ) {

          return mapTrainedUrl(
            context,
            record,
          );
        }


        const count =
          response.urls?.length ??
          0;


        if (
          count ===
          0
        ) {

          break;
        }


        processed +=
          count;


        if (
          count <
          pageLength
        ) {

          break;
        }


        page +=
          1;
      }


      return null;
    }


    /*
     * ------------------------------------------------
     * File
     * ------------------------------------------------
     */

    if (
      request.sourceType ===
      "file"
    ) {

      const detail =
        await ghlFetchAuthenticated<
          GHLFileDetailResponse
        >(
          ghlContext,

          `/knowledge-bases/files/${encodeURIComponent(
            request.providerDocumentId,
          )}`,

          {
            headers: {

              Version:
                "v3",
            },
          },
        );

      const record =
        detail.data;

      if (
        !record
      ) {

        return null;
      }

      return mapFile(
        context,

        record,
      );
    }


    /*
     * ------------------------------------------------
     * Table
     * ------------------------------------------------
     *
     * There is deliberately no invented endpoint here.
     * ------------------------------------------------
     */

    if (
      request.sourceType ===
      "table"
    ) {

      console.warn(
        "GHL table knowledge document requested, but table content retrieval is not implemented because the public API does not document a table-content endpoint.",
        {

          knowledgeBaseId:
            request.knowledgeBaseId,

          providerDocumentId:
            request.providerDocumentId,
        },
      );


      return null;
    }


    /*
     * ------------------------------------------------
     * Unknown source type
     * ------------------------------------------------
     */

    console.warn(
      "GHL Knowledge document source type is not supported by the provider mapper.",
      {

        knowledgeBaseId:
          request.knowledgeBaseId,

        sourceType:
          request.sourceType,

        providerDocumentId:
          request.providerDocumentId,
      },
    );


    return null;
  },
};