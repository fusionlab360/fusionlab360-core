# API client permission provisioning

Protected routes use the scopes in `src/clients/permissions.ts`. The `client:permissions` CLI command inspects and updates the JSON permission list on one existing client record. It does not create clients or change API keys.

## Operator workflow

From the repository root (through the existing CLI entry point):

```text
npm run client:permissions -- inspect --tenant <tenant-id> --client <client-id>
npm run client:permissions -- grant --tenant <tenant-id> --client <client-id> --scope <scope> [--scope <scope> ...]
npm run client:permissions -- grant --tenant <tenant-id> --client <client-id> --scope <scope> --apply --confirm <tenant-id>/<client-id>
npm run client:permissions -- revoke --tenant <tenant-id> --client <client-id> --scope <scope> --apply --confirm <tenant-id>/<client-id>
```

`grant` and `revoke` without `--apply` are previews. The default uses local Wrangler bindings. To intentionally target a remote environment, pass `--remote`; to select a named Wrangler environment, pass `--env <name>`. The command prints the target mode before reading the record. Every applied change requires the exact tenant/client confirmation string. Inspect the client first, review the proposed additions or removals, then apply only the requested scopes.

The client lookup uses both tenant ID and client ID in a prepared query. The update uses a prepared statement constrained by both IDs and the previously read permission JSON, so concurrent changes fail rather than overwrite newer grants. The command preserves unrelated existing entries. It never grants `*`; an existing legacy `*` can only be explicitly revoked. Unknown or malformed requested scopes are rejected. Malformed stored permission JSON blocks mutation.

This tool does not assign scopes automatically, verify business ownership of an operator-supplied tenant ID, or replace access controls on the machine running Wrangler. Operators must establish the target tenant/client identity through their existing approved inventory and Cloudflare account/environment controls before using `--remote`.

## Route permission matrix

| Scope | Protected operations |
| --- | --- |
| `contacts:create` | `POST /contacts` |
| `contacts:read` | `GET /contacts` |
| `contacts:update` | `PUT /contacts` |
| `contacts:delete` | `DELETE /contacts` |
| `reservations:sync` | `POST /reservations/sync` |
| `booking:read` | `GET /booking/offerings`, `POST /booking/availability` |
| `booking:create` | `POST /booking` |
| `booking:test` | `POST /booking/intent-test`, `POST /booking/ai-test` |
| `integrations:read` | `POST /integrations/preview`, `/discover`, `/gohighlevel/events/preview` |
| `integrations:write` | `POST /integrations/configure` |
| `integrations:oauth:connect` | `POST /oauth/gohighlevel/authorize` for the authenticated client's own inactive pending integration |
| `integrations:test` | `POST /integrations/gohighlevel/company/refresh-test` |
| `messaging:test` | `/messaging-test/*` conversation inspection and test reply routes |
| `ai:read` | `GET /ai/profile` |
| `ai:write` | `PUT /ai/profile` |
| `ai:test` | `/ai-test/chat`, `/ai-test/session` |
| `knowledge:read` | Knowledge base/document reads and search |
| `knowledge:write` | Knowledge sync and index operations |
| `knowledge:answer` | `POST /knowledge/answer` |
| `knowledge:evaluate` | `POST /knowledge/evaluate` retrieval evaluation |
| `features:read` | `GET /features` |
| `features:write` | `PATCH /features/:featureKey` |

Inbound GoHighLevel webhooks retain provider signature validation rather than API-client bearer scopes. OAuth routes retain their existing OAuth state/callback controls. Browser-extension behavior has no separately scoped route in the current protected route matrix; do not grant an unrelated scope on that assumption.

OAuth onboarding also requires the provider's exact registered scopes in the `GHL_OAUTH_SCOPES` Worker binding, alongside the existing OAuth client and callback configuration. Core does not infer or default provider scopes; initiation fails closed when the binding is missing or malformed. Configure it from the registered Marketplace app before enabling onboarding in an environment.

For a new tenant, use the existing tenant CLI and explicitly include `integrations:oauth:connect` in the client's permission list. Send `POST /oauth/gohighlevel/authorize` with that client's bearer API key, then send the returned authorization URL to the account administrator. The public callback consumes its hashed, expiring state once, validates the bound Company and Location, stores the Location credential, and activates only the matching pending tenant/integration. The endpoint does not accept caller-supplied tenant or provider-account IDs. If credential synchronization or activation is interrupted after the Location token is stored, call the same authenticated endpoint again to resume the conditional activation steps.

The existing seed grants contact CRUD scopes only. Existing clients therefore need an explicit reviewed grant for other operations they are meant to call. The CLI does not modify seed data or any client automatically.

For user JWTs, route authorization checks both the current client record and the signed principal permissions. After changing client scopes, issue a fresh JWT through the existing login flow if the user's token does not already contain the new scope.
