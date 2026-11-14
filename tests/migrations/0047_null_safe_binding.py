"""Check NULL-safe binding immutability on both historical schemas."""
from contextlib import closing
import sqlite3
import unittest

from importlib import import_module

fixtures = import_module("0045_legacy_review_upgrade")
ROOT = fixtures.ROOT
MIGRATIONS = ROOT / "migrations"
FIX = (MIGRATIONS / "0047_meta_whatsapp_null_safe_binding.sql").read_text()


class BindingMigrationTests(unittest.TestCase):
    def test_both_histories(self):
        for schema in (
            ROOT / "tests/fixtures/0042_original_pending.sql",
            MIGRATIONS / "0042_meta_whatsapp_connection_activation.sql",
        ):
            with self.subTest(schema=schema.name), closing(fixtures.pre_0042()) as db:
                db.executescript(schema.read_text(encoding="utf-8-sig"))
                db.executescript(fixtures.REVIEW)
                db.executescript((MIGRATIONS / "0046_meta_whatsapp_outbound_retry_cooldown.sql").read_text())
                db.execute("""UPDATE meta_whatsapp_connections SET activation_state='active',
                    ghl_location_id='loc-b', ghl_provider_id='provider-b',
                    activation_actor='reviewer', activation_reason='approved' WHERE id='old-b'""")
                # Model a historical partial binding written before the guard was fixed.
                db.execute("UPDATE meta_whatsapp_connections SET ghl_location_id=NULL WHERE id='old-b'")
                db.executescript(FIX)
                db.executescript(FIX)
                db.execute("UPDATE meta_whatsapp_connections SET ghl_location_id=NULL WHERE id='old-b'")
                db.execute("UPDATE meta_whatsapp_connections SET ghl_provider_id='provider-b' WHERE id='old-b'")
                db.execute("UPDATE meta_whatsapp_connections SET updated_at=CURRENT_TIMESTAMP WHERE id='old-b'")
                for change in ("ghl_location_id='loc-b'", "ghl_provider_id=NULL", "ghl_provider_id='other'"):
                    with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                        db.execute(f"UPDATE meta_whatsapp_connections SET {change} WHERE id='old-b'")
                if schema.parent == MIGRATIONS:
                    with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                        db.execute("UPDATE meta_whatsapp_connections SET ghl_location_id='loc-a', ghl_provider_id='provider-a' WHERE id='old-a'")
                    db.execute("""INSERT INTO meta_whatsapp_connection_activation_audit
                        (tenant_id, connection_id, ghl_location_id, actor_client_id, previous_state, new_state, reason, trace_id)
                        VALUES ('a','old-a','loc-a','reviewer','legacy_active','legacy_binding_established',
                        '{"ghlProviderId":"provider-a"}','verified-operation')""")
                    db.execute("""UPDATE meta_whatsapp_connections SET ghl_location_id='loc-a',
                        ghl_provider_id='provider-a', activation_trace_id='verified-operation' WHERE id='old-a'""")
                self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
