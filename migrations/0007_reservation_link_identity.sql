ALTER TABLE reservation_links
ADD COLUMN canonical_reservation_id TEXT;

ALTER TABLE reservation_links
ADD COLUMN provider TEXT;

ALTER TABLE reservation_links
ADD COLUMN provider_reservation_id TEXT;

ALTER TABLE reservation_links
ADD COLUMN provider_calendar_id TEXT;

ALTER TABLE reservation_links
ADD COLUMN provider_edit_id TEXT;

ALTER TABLE reservation_links
ADD COLUMN revision INTEGER;

ALTER TABLE reservation_links
ADD COLUMN last_event_id TEXT;