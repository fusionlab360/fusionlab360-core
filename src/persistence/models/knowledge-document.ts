export type KnowledgeDocumentStatus =
  | "active"
  | "deleted";


export interface KnowledgeDocumentRecord {

  id:
    string;

  tenantId:
    string;

  provider:
    string;

  knowledgeSourceId:
    string;

  providerDocumentId:
    string;

  sourceType:
    string;

  title:
    string | null;

  content:
    string | null;

  sourceUrl:
    string | null;

  mimeType:
    string | null;

  metadata:
    string | null;

  rawPayload:
    string | null;

  contentHash:
    string | null;

  sourceCreatedAt:
    string | null;

  sourceUpdatedAt:
    string | null;

  sourceDeletedAt:
    string | null;

  syncedAt:
    string | null;

  status:
    KnowledgeDocumentStatus;

  createdAt:
    string;

  updatedAt:
    string;
}