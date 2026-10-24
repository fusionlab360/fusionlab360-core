-- M6.3C: Durable synthetic STAAH booking submissions.
--
-- Internal mock-only data.
-- Not actual STAAH bookings or canonical reservations.
-- No GHL delivery or inventory deductions.
--
-- Apply only to a disposable local development D1 database
-- while the STAAH integration remains mock-only.

CREATE TABLE staah_mock_booking_submissions (
  tenant_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,

  provider_property_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (
    tenant_id,
    integration_id,
    idempotency_key
  ),

  CHECK (length(trim(tenant_id)) > 0),
  CHECK (length(trim(integration_id)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (
    provider_property_id GLOB 'mock-*'
  ),
  CHECK (length(request_hash) = 64),
  CHECK (json_valid(result_json))
);

CREATE INDEX idx_staah_mock_bookings_property
ON staah_mock_booking_submissions (
  tenant_id,
  integration_id,
  provider_property_id
);