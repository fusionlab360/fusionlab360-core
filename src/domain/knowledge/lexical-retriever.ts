import type {
  KnowledgeSearchMatch,
} from "../../integrations/knowledge/vectorize/retriever";

const STOP_WORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but",
  "what", "which", "where", "when", "who",
  "why", "how", "is", "are", "do", "does",
  "did", "can", "could", "would", "should",
  "you", "your", "we", "our", "i", "me", "my",
  "to", "of", "in", "on", "at", "for", "with",
  "about", "please", "tell", "give", "know",
  "apa", "adakah", "boleh", "nak", "mahu",
  "ingin", "berapa", "bila", "mana", "yang",
  "dan", "atau", "dengan", "untuk", "dari",
]);

interface LexicalKnowledgeRow {
  id: string;
  tenant_id: string;
  provider: string;
  knowledge_source_id: string;
  provider_document_id: string;
  source_type: string;
  title: string | null;
  content: string | null;
  bm25_score: number;
}

function extractTerms(
  queries: string[],
): string[] {
  const terms = queries
    .flatMap((query) =>
      query
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    )
    .filter(
      (term) =>
        term.length >= 2 &&
        !STOP_WORDS.has(term),
    );

  return [...new Set(terms)].slice(0, 12);
}

function buildMatchExpression(
  terms: string[],
): string {
  return terms
    .map(
      (term) =>
        `"${term.replace(/"/g, '""')}"*`,
    )
    .join(" OR ");
}

function buildEvidenceExcerpt(
  content: string,
  terms: string[],
  maxChars = 2400,
): string {
  if (content.length <= maxChars) {
    return content.trim();
  }

  const normalized = content.toLowerCase();

  const firstMatch = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;

  const start = Math.max(
    0,
    Math.min(
      firstMatch - Math.floor(maxChars / 3),
      content.length - maxChars,
    ),
  );

  const end = Math.min(
    content.length,
    start + maxChars,
  );

  const excerpt = content
    .slice(start, end)
    .trim();

  return [
    start > 0 ? "…" : "",
    excerpt,
    end < content.length ? "…" : "",
  ].join("");
}

export async function searchKnowledgeDocumentsLexically(
  db: D1Database,
  tenantId: string,
  query: string,
  topK = 20,
  alternateQueries: string[] = [],
): Promise<KnowledgeSearchMatch[]> {
  const terms = extractTerms([
    query,
    ...alternateQueries,
  ]);

  if (!tenantId.trim() || terms.length === 0) {
    return [];
  }

  const safeTopK = Math.min(
    Math.max(Math.floor(topK), 1),
    20,
  );

  const matchExpression =
    buildMatchExpression(terms);

  const sql = `
    SELECT
      d.id AS id,
      d.tenant_id AS tenant_id,
      d.provider AS provider,
      d.knowledge_source_id AS knowledge_source_id,
      d.provider_document_id AS provider_document_id,
      d.source_type AS source_type,
      d.title AS title,
      d.content AS content,
      bm25(
        knowledge_documents_fts,
        0.0,
        0.0,
        4.0,
        1.0
      ) AS bm25_score
    FROM knowledge_documents_fts
    INNER JOIN knowledge_documents d
      ON d.id = knowledge_documents_fts.document_id
      AND d.tenant_id = knowledge_documents_fts.tenant_id
    INNER JOIN knowledge_sources s
      ON s.id = d.knowledge_source_id
      AND s.tenant_id = d.tenant_id
    WHERE knowledge_documents_fts MATCH ?
      AND knowledge_documents_fts.tenant_id = ?
      AND d.status = 'active'
      AND s.status = 'active'
      AND LOWER(COALESCE(s.name, ''))
        NOT LIKE '%ai agent instructions%'
      AND TRIM(COALESCE(d.content, '')) <> ''
    ORDER BY
      bm25(
        knowledge_documents_fts,
        0.0,
        0.0,
        4.0,
        1.0
      ) ASC,
      d.updated_at DESC
    LIMIT ?
  `;

  const { results } = await db
    .prepare(sql)
    .bind(
      matchExpression,
      tenantId,
      safeTopK,
    )
    .all<LexicalKnowledgeRow>();

  return (results ?? [])
    .filter(
      (row) =>
        row.tenant_id === tenantId &&
        (row.content ?? "").trim().length > 0,
    )
    .map(
      (row, index): KnowledgeSearchMatch => ({
        id: `lex:${row.id}`,
        tenantId: row.tenant_id,
        provider: row.provider,
        sourceType: row.source_type,
        knowledgeSourceId: row.knowledge_source_id,
        providerDocumentId: row.provider_document_id,
        title: row.title ?? "",
        chunkIndex: 0,

        // Lexical results are not vector scores.
        score: 0,

        // Reciprocal rank is used for combining results.
        lexicalScore: 1 / (index + 1),
        lexicalRank: index + 1,
        retrievalMethod: "lexical",

        // Keep only an evidence excerpt instead of sending
        // an arbitrarily large document to the reranker.
        content: buildEvidenceExcerpt(
          row.content ?? "",
          terms,
        ),
      }),
    );
}