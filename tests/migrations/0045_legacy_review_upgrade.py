"""Exercise the forward-only legacy review bridge on both 0042 histories."""

from pathlib import Path
import sqlite3
import unittest


ROOT = Path(__file__).resolve().parents[2]
REVIEW = (ROOT / "migrations/0045_meta_whatsapp_legacy_review.sql").read_text(encoding="utf-8-sig")


def pre_0042() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for path in sorted((ROOT / "migrations").glob("*.sql")):
        if path.name.startswith("0042_"):
            break
        db.executescript(path.read_text(encoding="utf-8-sig"))
    db.execute("INSERT INTO tenants(id,name) VALUES('a','A'),('b','B')")
    db.execute("INSERT INTO integrations(id,tenant_id,provider) VALUES('ia','a','meta_whatsapp'),('ib','b','meta_whatsapp')")
    db.execute("INSERT INTO integration_credentials(tenant_id,provider,auth_type,location_id) VALUES('a','gohighlevel','oauth2','loc-a'),('b','gohighlevel','oauth2','loc-b')")
    db.execute("INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('old-a','a','ia','waba-a','phone-a','active'),('old-b','b','ib','waba-b','phone-b','active')")
    return db


def approval(db: sqlite3.Connection, connection: str, tenant: str, location: str) -> None:
    db.execute("INSERT INTO meta_whatsapp_legacy_approval_reviews(connection_id,tenant_id,ghl_location_id,ghl_provider_id,reviewer_client_id,evidence_ref) VALUES(?,?,?,?,?,?)", (connection, tenant, location, "provider", "reviewer", "review-record-1"))


class LegacyReviewUpgradeTests(unittest.TestCase):
    def test_0045_fails_closed_before_0042_without_leaving_partial_schema(self):
        db = pre_0042()
        with self.assertRaises(sqlite3.OperationalError):
            db.executescript("BEGIN;\n" + REVIEW + "\nCOMMIT;")
        if db.in_transaction:
            db.rollback()
        self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta_whatsapp_legacy_approval_reviews'").fetchone())
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_original_0042_requires_explicit_scoped_review(self):
        db = pre_0042()
        db.executescript((ROOT / "tests/fixtures/0042_original_pending.sql").read_text(encoding="utf-8-sig"))
        db.execute("INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('new-a','a','ia','new-waba','new-phone','active')")
        db.executescript(REVIEW)
        db.executescript(REVIEW)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM meta_whatsapp_legacy_approval_reviews").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT activation_state FROM meta_whatsapp_connections WHERE id='new-a'").fetchone()[0], "pending")
        with self.assertRaises(sqlite3.IntegrityError):
            approval(db, "old-b", "a", "loc-a")
        with self.assertRaises(sqlite3.IntegrityError):
            approval(db, "old-a", "a", "loc-b")
        approval(db, "old-a", "a", "loc-a")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE meta_whatsapp_legacy_approval_reviews SET evidence_ref='changed' WHERE connection_id='old-a'")
        db.execute("UPDATE meta_whatsapp_connections SET activation_state='active', ghl_location_id='loc-b', ghl_provider_id='provider', activation_actor='reviewer', activation_reason='approved_pilot' WHERE id='old-b'")
        db.execute("UPDATE meta_whatsapp_connections SET activation_state='suspended', activation_actor='reviewer', activation_reason='operator_pause' WHERE id='old-b'")
        with self.assertRaises(sqlite3.IntegrityError):
            approval(db, "old-b", "b", "loc-b")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_revised_0042_preserves_legacy_rows_without_review(self):
        db = pre_0042()
        db.executescript((ROOT / "migrations/0042_meta_whatsapp_connection_activation.sql").read_text(encoding="utf-8-sig"))
        db.executescript(REVIEW)
        db.executescript(REVIEW)
        self.assertEqual(db.execute("SELECT activation_state FROM meta_whatsapp_connections WHERE id='old-a'").fetchone()[0], "legacy_active")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM meta_whatsapp_legacy_approval_reviews").fetchone()[0], 0)
        db.execute("INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('new-a','a','ia','new-waba','new-phone','active')")
        self.assertEqual(db.execute("SELECT activation_state FROM meta_whatsapp_connections WHERE id='new-a'").fetchone()[0], "pending")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
