# Clinic Contact Event synchronization

The Clinic Patient Connector uses the existing bearer-authenticated `POST /contacts` route with `contacts:create`. The extension's Test button uses `GET /contacts/clinic-sync-capability` to establish support and access. This GET performs no provider writes.

The route uses Core's existing bearer API-key authentication. Core resolves the API key to its authenticated client, derives the tenant from that client, and loads that tenant's GHL integration and location credentials. It does not accept tenant, location or client identifiers from the extension and has no clinic-specific global Worker allowlists. The clinic contract fails closed unless that tenant's GHL configuration supplies `providerConfiguration.clinicContactSync.locationId` matching its stored GHL location credential and a `managedOwnerFieldKey`. The owner field must be a dedicated Contact Event text field, separate from title, date and type. Confirm the clinic's GHL identity-number mapping before exercising clear.

The capability and ordinary contact-upsert routes require the existing `contacts:create` permission. Snapshot replacement and explicit clear can delete managed Contact Event records, so those modes also require the existing `contacts:delete` permission. `note_only` does not require the delete permission. No new permission scope or API client is introduced; the checks use the authenticated client's existing permissions and the existing tenant-scoped GHL integration settings.

The request keeps the original top-level `notes`. Within the approved clinic contract `clinicNotesSync` is `replace`, `note_only` or `clear`, and `clinicNotesCapturedAt` is the epoch time in milliseconds of a fresh saved-notes read. Core accepts a capture up to two minutes old with up to 30 seconds of positive clock skew. The timestamp is a bound on request age. The extension is responsible for reading the full saved source field, and Core validates the caller and snapshot syntax independently.

- `replace` reconciles a valid, nonempty snapshot. The extension reads saved notes with a fresh same-origin Avixo request and checks the patient identity from that page. When the same editor is open, a disagreement between its contents and the saved notes defers the request.
- `note_only` leaves events alone. For a blank field it also leaves the managed native note alone.
- `clear` requires the operator to choose Clear synced Contact Events after saving the cleared source. The extension checks the current saved notes still match the explicit intent and expires the intent after 15 minutes. Core requires an existing verified contact and a stable identity number. It clears only owned event records. A blank native note remains untouched.

Contract responses retain the saved contact and add `synchronization` with `contactSaved`, `nativeNote`, `contactEvents`, `status` and `retryable`. Either stage can be `synchronized`, `skipped`, or `failed`. A provider failure after the contact save returns `partial_failure` with the stage states. The extension acknowledges the queue job only when its required stages succeed. It retries transient failures up to three times at five, ten, and twenty minutes, reading current saved notes before each attempt. It retains failed jobs for review.

Existing unmarked Contact Event records are outside the new scoped replacement. Review their provenance before any adoption. Never tag records based only on matching dates or descriptions. Validate the unmarked-to-managed transition before using existing patient data. Core requires a complete association response with a matching total and verified contact/location metadata before event reconciliation.

The adapter serializes clinic note and event stages and rejects older capture times in the same Worker isolate. This state is bounded and volatile. It does not provide ordering across isolates, regions, browser profiles or Worker restarts. A timeout with an ambiguous provider outcome can leave an orphan or a duplicate if the write is not visible when the retry reads it. Reconciliation is not a provider transaction. Verify the provider's responses in nonproduction and avoid simultaneous writers for the same contact.

## Nonproduction acceptance

1. Use a synthetic patient, an isolated GHL location and the matching Core client. Verify the exact configured API origin and run the extension's authenticated connection test.
2. Save three dated entries with mixed paragraph and break markup. Confirm three Contact Event records, the contact association, preserved original native notes, and no changes to a seeded manual note or unmarked event.
3. Change one date, delete another line and repeat the identical snapshot. Confirm the old records are removed and the unchanged record keeps its ID.
4. Simulate a GHL write failure. Confirm Core reports partial success and the extension retries with freshly read notes. Confirm no job is acknowledged early.
5. Save a history with no dated entries and explicitly clear it. Confirm only marked events are removed. Check malformed, missing, unsaved, wrong-contact and wrong-environment inputs leave events intact.
6. Review the separate reminder behavior without activating live workflows. Promote neither artifact until the test passes and the legacy ownership and cutover plans have been approved.
