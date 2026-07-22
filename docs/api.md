# API Reference

Home Lab Launcher exposes a JSON API under `/api`. The API is pre-1.0 and intended for the bundled frontend, trusted plugins, and operator automation on private deployments.

The machine-readable API contract lives in [`docs/openapi.json`](openapi.json) and is served by the app at `/api/openapi.json`. Treat that contract as the canonical endpoint inventory for tooling, client generation, and contract review. This Markdown page remains the human overview and should be updated alongside the OpenAPI document whenever routes, request bodies, response envelopes, auth rules, or CSRF behavior change.

## Conventions

- JSON request bodies use `Content-Type: application/json`.
- Successful responses use a resource envelope such as `{ "service": ... }`, `{ "services": [...] }`, or endpoint-specific status fields.
- Errors use `{ "error": "message" }` with an appropriate HTTP status.
- Mutating routes require the session CSRF token in `X-CSRF-Token` after login. `/api/auth/login` returns the token.
- Automation can authenticate with an Admin-issued API token in `Authorization: Bearer hll_…` instead of a session. Token requests skip CSRF (no cookies are involved), act with the token's role, and are rejected on session/profile endpoints (`/api/auth/*`, `/api/me*`, `/api/bootstrap*`).
- The OpenAPI spec models the session cookie as `hll.sid` and mutating authenticated routes with `X-CSRF-Token` security.
- Authenticated and read-gated requests revalidate the session user against the database before trusting cached session identity. Deleted users are rejected, role changes take effect immediately, and account security changes revoke affected sessions.
- Role names are `admin`, `editor`, and `user`. Anonymous access to read routes depends on `PUBLIC_READ_ENABLED` / Admin settings.
- Server-side URL tests, health checks, and image downloads apply the configured private-network SSRF policy.

## Public and session routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/healthz` | Public | Minimal health check with `{ ok, version, uptimeSeconds }`. |
| `GET` | `/api/openapi.json` | Public | Machine-readable OpenAPI 3.1 API contract. |
| `GET` | `/api/bootstrap-status` | Public | Reports whether first-admin setup is still required. |
| `POST` | `/api/bootstrap` | Public until bootstrapped | Creates the first Admin account when no users exist; optional `totpSecret` + six-digit `totpCode` enables 2FA immediately and returns shown-once `recoveryCodes`. |
| `POST` | `/api/auth/login` | Public | Starts a session and returns `{ user, csrfToken }`, or `{ requiresTotp: true }` when a valid password needs a TOTP code. Accepts `{ code }` (TOTP) or `{ recoveryCode }` (single-use backup code). |
| `POST` | `/api/auth/logout` | Session | Ends the current session. |
| `GET` | `/api/auth/session` | Public | Returns current session user, if any. |
| `GET` | `/api/me` | Session | Returns the current user, including `recoveryCodesRemaining` when 2FA is enabled. |
| `PATCH` | `/api/me/password` | Session | Changes the current user's password and revokes other active sessions. |
| `POST` | `/api/me/totp/setup` | Session | Generates a new Base32 TOTP secret for the current user's authenticator app. |
| `POST` | `/api/me/totp/enable` | Session | Verifies a six-digit TOTP code, enables 2FA, and returns ten shown-once single-use `recoveryCodes`. |
| `POST` | `/api/me/totp/recovery-codes` | Session | Replaces all recovery codes with a fresh shown-once set. Requires `{ password, code }` (current TOTP code). |
| `POST` | `/api/me/totp/disable` | Session | Disables 2FA for the current user and deletes recovery codes. Requires `{ password }` and, when 2FA is enabled, `{ code }`; other sessions are revoked after disable. |
| `GET` | `/api/me/sessions` | Session | Lists active sessions for the current user. |
| `DELETE` | `/api/me/sessions/:sid` | Session | Revokes one active session. |
| `DELETE` | `/api/me/sessions` | Session | Revokes other sessions for the current user. |

## Public settings, services, and assets

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/settings/public` | Public | Public runtime settings, appearance, and anonymous-read status. |
| `GET` | `/api/services` | Public if enabled, otherwise session | Lists enabled/visible services with health metadata, including `health.uptime24h` (percentage over the last 24h of samples, `null` without history). |
| `GET` | `/api/service-health` | Public if enabled, otherwise session | Lists service health rows. |
| `GET` | `/api/service-icons/:filename` | Public/Session | Serves stored service icons. Requires launcher read access when public read is disabled. |
| `GET` | `/api/app-assets/:filename` | Public | Serves stored branding assets. Treat branding assets as public. |

## Service management

Admins and Editors can manage services.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/services` | Create a service. Supports emoji/text icons, uploaded image data, remote icon download, categories, tags, featured/enabled flags, and health-check settings. |
| `PATCH` | `/api/services/:id` | Update one service. |
| `DELETE` | `/api/services/:id` | Delete one service. |
| `PATCH` | `/api/services/reorder` | Persist service sort order. |
| `POST` | `/api/services/:id/duplicate` | Duplicate a service with a new ID/name. |
| `PATCH` | `/api/services/bulk` | Bulk enable, disable, feature, unfeature, categorize, or delete selected services. |
| `POST` | `/api/services/test-url` | Test a URL from the server subject to SSRF policy. |
| `POST` | `/api/services/:id/check` | Run one service health check immediately. |
| `GET` | `/api/services/export` | Export service configuration JSON. |
| `POST` | `/api/services/import` | Import service configuration JSON. |

## User preferences

Logged-in users can manage their own preferences. Basic Users are limited to personal launchpad state such as favorites, favorite order, view mode (`cards`, `compact`, `icon`, or `list`), hidden categories, and trusted plugin preferences stored under the `plugins` namespace.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/me/preferences` | List current user's preferences. |
| `PUT` | `/api/me/preferences/:key` | Save one allowed preference. |
| `DELETE` | `/api/me/preferences/:key` | Delete one preference. |

Allowed preference keys are `favorites`, `launchpad`, and `plugins`. Plugin preferences are stored as a bounded object keyed by plugin ID, for example `{ "hll-weather": { "theme": "pixel" } }`.

## Admin settings and management plane

Admin-only routes.

| Method | Path | Purpose |
| --- | --- | --- |
| `PATCH` | `/api/settings` | Update app settings such as app name, base URL, public read, backup note, `health_webhook_url`, and `health_history_retention_days`. |
| `GET` | `/api/admin/api-tokens` | List issued API tokens (metadata only — never the secret). |
| `POST` | `/api/admin/api-tokens` | Create an API token with `{ name, role, expiresDays? }`. The plaintext `token` is returned exactly once. |
| `DELETE` | `/api/admin/api-tokens/:id` | Revoke an API token immediately. |
| `GET` | `/api/admin/overview` | Counts, runtime summary, warnings, notices, and readiness information. |
| `GET` | `/api/admin/health` | Runtime, config, plugin, and scheduled-job health. |
| `GET` | `/api/admin/config` | Effective non-secret configuration diagnostics. |
| `GET` | `/api/admin/notices` | Current Admin notices. |
| `GET` | `/api/admin/logs` | Filtered audit logs. |
| `GET` | `/api/admin/logs/export` | Audit-log JSON export. |
| `PATCH` | `/api/admin/logs/retention` | Update audit-log retention days. |
| `POST` | `/api/admin/logs/prune` | Prune old audit logs. |
| `GET` | `/api/admin/backup` | Download portable config backup. |
| `GET` | `/api/admin/database/export` | Download SQLite database export. |
| `POST` | `/api/admin/restore/preview` | Validate and summarize a config restore payload. |
| `POST` | `/api/admin/restore` | Restore supported settings/services from backup JSON. |

## Appearance and theme presets

Admin-only routes.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/appearance` | Read current appearance settings. |
| `PUT` | `/api/admin/appearance` | Replace sanitized appearance settings. |
| `POST` | `/api/admin/appearance/reset` | Restore default appearance. |
| `POST` | `/api/app-assets` | Upload one branding asset from a data URL. |
| `GET` | `/api/admin/theme-presets` | List saved theme presets. |
| `POST` | `/api/admin/theme-presets` | Save a theme preset. |
| `PATCH` | `/api/admin/theme-presets/:id` | Rename/update preset metadata or appearance. |
| `POST` | `/api/admin/theme-presets/:id/apply` | Apply a preset to the current appearance. |
| `DELETE` | `/api/admin/theme-presets/:id` | Delete a preset. |
| `GET` | `/api/admin/theme-presets/:id/export` | Export a shareable theme preset JSON payload. |
| `POST` | `/api/admin/theme-presets/import` | Import a shareable theme preset JSON payload. |

## Users

Admin-only routes.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/users` | List users. |
| `POST` | `/api/users` | Create a user. |
| `PATCH` | `/api/users/:id` | Change username, role, password, or reset the user's TOTP 2FA state with `resetTotp`. Password changes, role changes, and TOTP resets revoke target-user sessions. The last Admin cannot be demoted. |
| `DELETE` | `/api/users/:id` | Delete a user and revoke their sessions. The last Admin cannot be deleted. |

## Preset catalog

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/presets/search` | Admin or Editor | Search cached local and remote presets by name, description, or category. |
| `POST` | `/api/admin/presets/import` | Admin or Editor | Import a preset by ID, validating the selected or preset-provided URL with normal service URL rules, then downloading/caching its icon and creating a new service. Presets without a website require a non-empty `customUrl`. |
| `POST` | `/api/admin/presets/update` | Admin | Trigger an asynchronous manual catalog update crawl with a 60-second cooldown rate-limit. |
| `GET` | `/api/admin/presets/settings` | Admin | Read preset catalog settings, statistics, and sync cooldown state. |
| `PUT` | `/api/admin/presets/settings` | Admin | Update preset catalog settings, such as enabling or disabling remote presets. |

## Plugin management API

Plugin installation and lifecycle management is Admin-only unless noted. Plugin config writes are available to Admins and Editors, but manifest field scopes decide which fields Editors may change.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/plugins` | Session | List installed plugins and config visible to the current role. |
| `GET` | `/api/plugins/enabled-sections` | Public if enabled, otherwise session | Lists enabled frontend sections contributed by plugins. |
| `GET` | `/api/plugins/:id/logs` | Admin | Plugin log entries. |
| `POST` | `/api/plugins/reload` | Admin | Reload installed plugins. |
| `GET` | `/api/plugin-sources/github/versions` | Admin | Discover GitHub releases/tags for a plugin repository. |
| `GET` | `/api/plugin-sources/updates` | Admin | Check installed plugins for available updates. |
| `GET` | `/api/plugin-catalog` | Admin | Browse the curated plugin catalog with compatibility and installed-state annotations (`?refresh=1` forces a remote fetch). |
| `GET` | `/api/plugin-sources/local/status` | Admin | Report whether local plugin install mode is enabled. |
| `POST` | `/api/plugins/install` | Admin | Install a trusted GitHub plugin version, optionally verifying SHA-256. |
| `POST` | `/api/plugins/install-local` | Admin | Install a trusted local plugin path when local mode is enabled. |
| `POST` | `/api/plugins/:id/update` | Admin | Update one plugin to a selected version/path. |
| `PATCH` | `/api/plugins/:id` | Admin | Enable/disable plugin lifecycle state. |
| `PUT` | `/api/plugins/:id/config` | Admin or Editor | Save scoped plugin config fields. |
| `DELETE` | `/api/plugins/:id` | Admin | Remove a plugin. |

## Plugin extension API

Trusted plugins run server-side and may extend the API through the plugin context described in [plugins.md](plugins.md). A plugin may:

- register backend routes under its plugin namespace,
- create SQLite tables/migrations through its lifecycle hooks,
- register scheduled jobs that appear in Admin health,
- expose static frontend assets, and
- contribute dashboard sections returned by `/api/plugins/enabled-sections`.

Plugin authors should keep route responses consistent with the core convention: resource envelopes for success and `{ "error": "message" }` for failures. Document every plugin-provided route in the plugin README because plugin routes are not enumerated by the core API reference.

`GET`/`HEAD` requests to plugin routes under `/api/plugins/:id/*` are gated by the launcher's public-read setting unless the plugin manifest sets `"publicAccess": true` — see [plugins.md](plugins.md#public-read-gate-on-plugin-routes).

## Operator examples

Login and capture the CSRF token and session cookie:

```bash
curl -i -sS -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me"}'
```

Create a service with the returned `hll.sid` cookie and `csrfToken`:

```bash
curl -sS -X POST http://localhost:8080/api/services \
  -H 'Content-Type: application/json' \
  -H 'Cookie: hll.sid=SESSION_COOKIE_VALUE' \
  -H 'X-CSRF-Token: CSRF_TOKEN_VALUE' \
  -d '{"name":"Grafana","url":"https://grafana.example.test","category":"monitoring"}'
```

Update public-read settings:

```bash
curl -sS -X PATCH http://localhost:8080/api/settings \
  -H 'Content-Type: application/json' \
  -H 'Cookie: hll.sid=SESSION_COOKIE_VALUE' \
  -H 'X-CSRF-Token: CSRF_TOKEN_VALUE' \
  -d '{"public_read_enabled":false}'
```

Export a portable config backup:

```bash
curl -sS http://localhost:8080/api/admin/backup \
  -H 'Cookie: hll.sid=SESSION_COOKIE_VALUE' \
  -o home-lab-launcher-backup.json
```

Revoke other sessions for the current user:

```bash
curl -sS -X DELETE http://localhost:8080/api/me/sessions \
  -H 'Cookie: hll.sid=SESSION_COOKIE_VALUE' \
  -H 'X-CSRF-Token: CSRF_TOKEN_VALUE'
```

Automate with an API token (no cookies or CSRF token needed):

```bash
curl -sS -X POST http://localhost:8080/api/services \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer hll_YOUR_TOKEN_VALUE' \
  -d '{"name":"Grafana","url":"https://grafana.example.test","category":"monitoring"}'
```
