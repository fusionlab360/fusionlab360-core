export type KnowledgeSourceStatus =
  | "active"
  | "deleted";


export interface KnowledgeSourceRecord {

  id:
    string;

  tenantId:
    string;

  provider:
    string;

  providerSourceId:
    string;

  name:
    string;

  description:
    string | null;

  metadata:
    string | null;

  rawPayload:
    string | null;

  sourceCreatedAt:
    string | null;

  sourceUpdatedAt:
    string | null;

  syncedAt:
    string | null;

  status:
    KnowledgeSourceStatus;

  createdAt:
    string;

  updatedAt:
    string;
}