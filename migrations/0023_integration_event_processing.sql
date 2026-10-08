ALTER TABLE integration_events
ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'received';

ALTER TABLE integration_events
ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE integration_events
ADD COLUMN processing_started_at TEXT;

ALTER TABLE integration_events
ADD COLUMN processed_at TEXT;

ALTER TABLE integration_events
ADD COLUMN last_error_code TEXT;

ALTER TABLE integration_events
ADD COLUMN last_error_message TEXT;

CREATE INDEX idx_integration_events_processing
ON integration_events (
  processing_status,
  processing_started_at
);