import type {
  Tenant,
} from "../../tenants/types";

import type {
  IntegrationRuntime,
} from "../integration/runtime";


export interface KnowledgeContext {

  tenant:
    Tenant;

  requestId:
    string;

  receivedAt:
    Date;

  integrationRuntime:
    IntegrationRuntime;
}


export type KnowledgeSourceType =
  | "faq"
  | "file"
  | "website"
  | "rich_text"
  | "table"
  | "unknown";


export type KnowledgeSyncMode =
  | "full"
  | "incremental";


export interface KnowledgeSyncRequest {

  mode:
    KnowledgeSyncMode;

  knowledgeBaseId:
    string;

  sourceType?:
    KnowledgeSourceType;

  providerDocumentId?:
    string;

  deleted?:
    boolean;
}


export interface KnowledgeBase {

  id:
    string;

  tenantId:
    string;

  provider:
    string;

  providerKnowledgeBaseId:
    string;

  name:
    string;

  description?:
    string;

  sourceTypes:
    KnowledgeSourceType[];

  createdAt?:
    string;

  updatedAt?:
    string;
}


export interface KnowledgeDocument {

  id:
    string;

  tenantId:
    string;

  provider:
    string;

  providerDocumentId:
    string;

  knowledgeBaseId:
    string;

  sourceType:
    KnowledgeSourceType;

  title?:
    string;

  content?:
    string;

  sourceUrl?:
    string;

  mimeType?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;

  createdAt?:
    string;

  updatedAt?:
    string;
}


export interface KnowledgeProvider {

  listKnowledgeBases(
    context:
      KnowledgeContext,
  ): Promise<
    KnowledgeBase[]
  >;


  listDocuments(
    context:
      KnowledgeContext,

    knowledgeBaseId:
      string,
  ): Promise<
    KnowledgeDocument[]
  >;


  getDocument?(
    context:
      KnowledgeContext,

    request:
      KnowledgeSyncRequest,
  ): Promise<
    KnowledgeDocument |
    null
  >;
}