
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_documents_fts
USING fts5(
  document_id UNINDEXED,
  tenant_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Rebuild the derived index from the authoritative documents table.
-- This prevents duplicate index entries if the SQL is rerun.
DELETE FROM knowledge_documents_fts;

INSERT INTO knowledge_documents_fts (
  document_id,
  tenant_id,
  title,
  body
)
SELECT
  id,
  tenant_id,
  COALESCE(title, ''),
  COALESCE(content, '')
FROM knowledge_documents
WHERE TRIM(COALESCE(content, '')) <> '';

CREATE TRIGGER IF NOT EXISTS knowledge_documents_fts_insert
AFTER INSERT ON knowledge_documents
BEGIN
  INSERT INTO knowledge_documents_fts (
    document_id,
    tenant_id,
    title,
    body
  )
  SELECT
    NEW.id,
    NEW.tenant_id,
    COALESCE(NEW.title, ''),
    COALESCE(NEW.content, '')
  WHERE TRIM(COALESCE(NEW.content, '')) <> '';
END;

CREATE TRIGGER IF NOT EXISTS knowledge_documents_fts_delete
AFTER DELETE ON knowledge_documents
BEGIN
  DELETE FROM knowledge_documents_fts
  WHERE document_id = OLD.id
    AND tenant_id = OLD.tenant_id;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_documents_fts_update
AFTER UPDATE OF id, tenant_id, title, content
ON knowledge_documents
BEGIN
  DELETE FROM knowledge_documents_fts
  WHERE document_id = OLD.id
    AND tenant_id = OLD.tenant_id;

  INSERT INTO knowledge_documents_fts (
    document_id,
    tenant_id,
    title,
    body
  )
  SELECT
    NEW.id,
    NEW.tenant_id,
    COALESCE(NEW.title, ''),
    COALESCE(NEW.content, '')
  WHERE TRIM(COALESCE(NEW.content, '')) <> '';
END;
