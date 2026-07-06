# Changelog

All notable changes to Home Lab Launcher will be documented here.

The project follows a lightweight semantic-versioning style while it is pre-1.0: minor versions may include breaking changes, and patch versions should be safe fixes.

## [0.9.1] - 2026-07-06

### Added

- Added a role-aware command palette opened from the header or `Ctrl+K`/`Cmd+K`, plus `/` to focus launchpad search. The palette indexes visible services, categories, plugin sections, admin tabs, profile actions, docs links, and safe management actions such as copy URL, toggle favorite, run health check, add/edit service, export backup, jump to logs, export logs, and open plugin settings/logs.
- Added Admin-only service discovery (Admin → Discovery): scan running containers through an explicitly configured Docker endpoint (read-only socket proxy recommended; the socket is never mounted by default) or paste Compose YAML as untrusted input, then review candidates — with URL/id conflict detection, per-candidate editing, and create/update/skip choices — before anything is imported. Candidates are built from names, images, published ports, and an allowlist of labels (`home-lab-launcher.*`, `homepage.*`, Traefik `Host()` rules, Compose project/service); environment values, secrets sections, and secret-like label keys are never read, and credentials embedded in URLs are stripped. Imports run through standard service validation (max 50 per batch) and every scan and import is audit-logged. New `yaml` dependency for strict Compose parsing with alias-expansion and size limits.
- Added a curated plugin catalog to Admin → Plugins. The catalog is static JSON fetched from the official `home-lab-launcher-plugins` repository (override with `PLUGIN_CATALOG_URL`), cached server-side for 15 minutes with a manual refresh button, and Admin-only. Entries show trust status (official/community), description, declared permissions, launcher API compatibility, repository/docs links, installed state, and an update hint, so admins can compare plugins before installing. Installing from the catalog reuses the existing pinned GitHub install path — live version discovery with release notes, explicit version pinning, the trust acknowledgement, and optional SHA-256 verification (prefilled when the catalog provides a hash for the selected version). Manual GitHub URL installs are unchanged. Catalog fetches, fetch failures, and catalog-originated installs are audit-logged, and a catalog outage never affects installed plugins — the last cached copy is served and marked stale.

## [0.8.1] - 2026-07-04

### Fixed

- The built-in theme presets (Daybreak, Daybreak Night, Vaporwave) shipped in 0.8.0 never actually appeared: startup seeding always wrote an empty `theme_presets` list, so the built-in fallback was unreachable on every install. They are now merged into the stored preset list once at startup (marker-gated), on both fresh installs and upgrades. Existing installs keep their active theme untouched — the built-ins simply appear as options under Admin → Appearance → Theme presets — and custom presets, ordering, and deletions of built-ins are preserved across restarts.

## [0.8.0] - 2026-07-04

### Changed

- **Daybreak UI rebrand.** The default look is now "Daybreak": a bright cool-paper light theme (cobalt `#2f55e0` primary, pill-shaped buttons/chips/search under the soft radius preset, soft 22px card radii and layered shadows) with a matching "Daybreak Night" dark palette. Fresh installs default to light mode; existing installs keep whatever mode is stored. Component styling that was hardcoded to the old sky-blue/dark look (toast, user dropdown, focus rings, drag handles, badges, preset badges, error banners) now derives from the contract tokens via `color-mix`, so every component follows admin theme overrides. Light mode overrides the semantic colors (`success`/`warning`/`danger`) with darker tones for AA contrast on white. A new `--radius-btn` token rides the existing radius presets (soft = pills, rounded = 12px, square = 6px), the hero image overlay derives from `--surface` instead of a hardcoded dark gradient, and seeded services plus the service accent-color choices use the new palette. The theming contract is unchanged: all 14 admin-overridable tokens, the theme/density/radius/font body classes, and theme JSON import/export keep working.

### Added

- **Built-in theme presets.** Admin → Appearance → Theme presets now ships with three built-ins: Daybreak (default light), Daybreak Night (dark), and Vaporwave (dusk violet with neon pink). They ride the normal preset pipeline — apply, duplicate, export, delete — and seed the list only until an admin saves their own set; a stored preset list always wins.

## [0.7.0] - 2026-07-04

### Security

- The regex-based hero-subheading HTML sanitizer was replaced with the maintained `sanitize-html` package. The allowlist is unchanged (`strong`/`em`/`b`/`i`/`code`/`br`/`p`/`ul`/`ol`/`li`/`a` with http(s) `href` only); script/style element *content* is now discarded instead of surviving as text.
- Sessions now roll on activity and honor a configurable lifetime: `SESSION_MAX_AGE_DAYS` (default 14, clamped 1–90) applies to both the cookie and the server-side session row.
- Plugin `GET`/`HEAD` API routes under `/api/plugins/:id/*` are now gated by the launcher's public-read setting before the plugin sees the request. Plugins serving intentionally public data can opt out with `"publicAccess": true` in their manifest.

### Added

- **TOTP recovery codes** (migration 7): enabling 2FA (including at bootstrap) generates ten single-use, bcrypt-hashed recovery codes shown exactly once, with copy/download in the UI. A recovery code signs in via the new "Use a recovery code instead" login option; each use is audit-logged with the remaining count. The profile shows how many codes remain and can regenerate a fresh set (`POST /api/me/totp/recovery-codes`, current password + TOTP code required). Codes are deleted on 2FA disable and admin 2FA reset.
- **API tokens for automation** (migration 8): Admins can issue role-scoped bearer tokens (`Authorization: Bearer hll_…`) with optional expiry from Admin → Security. Tokens are stored as SHA-256 hashes with a display prefix, track last use, revoke instantly, skip CSRF (no cookies involved), are rejected on session/profile endpoints, and appear in the audit log as `token:<name>`. The secret is shown exactly once at creation.
- **Forward-auth via trusted reverse-proxy header** (Authelia/authentik pattern): opt in with `AUTH_PROXY_ENABLED=true` plus `AUTH_PROXY_USERNAME_HEADER` (default `remote-user`), `AUTH_PROXY_AUTO_CREATE`, and `AUTH_PROXY_DEFAULT_ROLE`. Requires `TRUST_PROXY`; the server refuses to start when misconfigured. Never applies to API-token requests.
- **Health-check history and 24h uptime** (migration 9): every health sample is recorded to `service_health_history`, pruned on a configurable retention (`health_history_retention_days`, default 7, max 90). Service payloads now include `health.uptime24h`, shown as a colorized badge in the admin services list.
- **Webhook notifications on health transitions**: configure `health_webhook_url` in Admin → Settings to receive a JSON POST when a monitored service goes down or recovers (up→down / down→up only). The payload carries `title`/`message`/`priority` (ntfy/Gotify) and `content` (Discord) plus structured fields, is sent through the SSRF-guarded fetcher, and is audit-logged.

### Changed

- **Dashboard UI refresh** (styles only; no markup or theming-contract changes). The dark control-plane look and single accent color are kept but sharpened: introduced spacing and shadow scales for consistent rhythm; the hero headline scales up with tighter tracking and balanced wrapping. Service cards drop the gradient fill for a flat surface with a subtle shadow, gain a lift-on-hover and a `:focus-within` ring, and keep their row actions quiet until hover/focus. Status badges (online/down/pending/disabled) now use soft tinted fills plus a status dot so state never depends on color alone. Machine data (hosts, version pill, favorite hostnames) is set in a monospace stack. Launchpad controls became category chips plus a segmented Cards/Compact/List switch and a magnifier-icon search field. A light-theme accent-on-white contrast issue was fixed via a dedicated `--primary-text` token, and a favorites-tile bug where a long hostname pushed the service name under the reorder buttons was corrected. All 14 admin-overridable theme tokens are unchanged, so customization still cascades.
- Plugin installs and updates now clean up superseded install directories and leftover download archives in the plugin directory after success; rolled-back updates keep their previous directory.
- The SQLite session store implements `touch()`, so rolling sessions extend the stored expiry instead of only the cookie.
- `/api/admin/config` now reports `healthWebhookUrl` and `healthHistoryRetentionDays`; `/api/me` reports `recoveryCodesRemaining` when 2FA is enabled.
- Installer scripts and README examples now default to the `v0.7.0` image tag.
- `docs/openapi.json` documents the bearer-token security scheme and all new endpoints, and its `info.version` (previously stale at 0.5.2) now tracks the release.

## [0.6.0] - 2026-07-02

### Security

- Plugin configuration returned by `GET /api/plugins` is now redacted by role: admin-scoped fields (such as connected-service API tokens) and fields without a declared config scope are only visible to Admins; Editors and Basic Users only see fields their role could write. Previously any authenticated user could read the full plugin config, including secrets.
- Login no longer reveals whether a username exists through response timing: a constant-cost dummy hash comparison runs when the username is unknown.
- Added a per-IP login failure cap (20 failures per 15 minutes across all usernames) alongside the existing per-user throttle, so a single IP can no longer spray passwords across many usernames.
- Password hashing and verification in request handlers now run asynchronously, so login attempts no longer block the event loop (a denial-of-service vector under concurrent logins).
- TOTP codes can no longer be replayed: the launcher records the last accepted code counter per user and rejects reuse within the validity window (login, enable, and disable flows).
- Uploaded SVG service icons are now served with a `Content-Security-Policy: sandbox` header and `Cross-Origin-Resource-Policy: same-origin`, neutralizing stored-XSS via crafted SVG files opened directly.
- API responses are sent with `Cache-Control: no-store` (content-hashed icon and asset files keep long-lived immutable caching).
- The plugin loader validates `backend`/`frontend` manifest paths against directory traversal before requiring or mounting them.

### Added

- Scheduled config backups: when the Admin → Backups "Scheduled backup location" is set, the launcher now writes a daily JSON config backup there and keeps the most recent 14 files. This setting previously existed but was documentation-only.
- Automatic maintenance jobs: expired sessions are pruned hourly and audit logs are pruned daily according to the configured retention, both visible under scheduled jobs in `/api/admin/health`.
- New plugin backend context helpers (non-breaking, API v1): `guardedFetch` (SSRF-guarded, size-limited fetch), `canRead(req)` (session-or-public-read gate), and `requireRole(...roles)` middleware. Documented in `docs/plugins.md`.

### Changed

- Admin → Backups now warns that config backups include plugin configuration values, which may contain API tokens.
- Installer scripts and README examples now default to the `v0.6.0` image tag (previously stale at `v0.3.7`).
- CI: pushes to the same branch cancel superseded runs, jobs have explicit timeouts, npm installs skip audit/fund checks, and the container smoke test reuses the already-built image instead of rebuilding it.

## [0.5.2] - 2026-06-22

### Changed

- Improved mobile formatting for the launchpad and Admin console, including horizontally scrollable Admin tabs, safer narrow-screen header behavior, better dialog sizing, and long-content wrapping for logs, URLs, plugin paths, and service management rows.
- Updated release documentation and image examples for the current `v0.5.2` patch release and Node 22 runtime baseline.

### Added

- Added a generic per-user plugin preferences namespace so trusted plugins can persist display preferences such as plugin-local themes.
- Added plugin development guidance for responsive dashboard sections, launcher design tokens, reduced-motion behavior, and plugin-local themes.

## [0.5.1] - 2026-06-18

### Added

- Added an "Add Service" shortcut button (+) next to the search box in the Service Launchpad.

## [0.5.0] - 2026-06-18

### Changed

- Moved the supported Node.js runtime and Docker base image from Node 20/22 to Node 22 only.
- Updated GitHub Actions workflow steps to `actions/checkout@v5` and `actions/setup-node@v5`.

## [0.4.2] - 2026-06-18

### Added

- Added per-user launchpad sort preferences for custom, alphabetical, and category service ordering.
- Added a `CONTAINER_NAME` Docker Compose override for isolated local test deployments while preserving the default `home-lab-launcher` container name.

### Fixed

- Improved browser first-admin setup validation so short usernames/passwords and incomplete TOTP setup are explained inline before submitting.
- Preserved non-visible services in the saved custom service order when cards are dragged while search or category filters are active.

## [0.4.1] - 2026-06-17

### Changed

- Updated developer guidelines in `AGENTS.md` to reference the new local tracking directory `dev/`.

### Removed

- Cleaned up development workspace directories by purging completed roadmap/todo files (`docs/v0.4.0/todo.md`, `dev/minor-release-3.md`, `dev/minor-release-3-cleanup.md`, `dev/bug-preset-catalog-update-status.md`, `dev/catalog.md`, and root `ROADMAP.md`).
- Purged local temporary/development database files (`:memory/launcher.sqlite` and `data/launcher.sqlite`) and local `.env` file from the workspace root.

## [0.4.0] - 2026-06-17

### Added

- Added a machine-readable OpenAPI 3.1 contract in `docs/openapi.json` and linked it from the API/development docs.
- Added `/api/openapi.json` and an `npm run openapi:check` validation gate for the API contract.

### Changed

- Authenticated and read-gated requests now revalidate session users against the database so deleted accounts and role changes take effect immediately.
- Account security changes now revoke affected sessions, including password changes, Admin password resets, Admin TOTP resets, role downgrades, and account deletion.
- User management now prevents removing the last Admin account.
- Preset imports now validate service URLs with the same HTTP/HTTPS rules as normal service creation, reject entries with no selected URL or preset website fallback, and validate before caching icons.

### Security

- Hardened CSRF token checks with timing-safe comparison while preserving the existing error response shape.

## [0.3.9] - 2026-06-15

### Fixed

- Failed service launchpad health checks now write warning entries to the Admin logs.

## [0.3.8] - 2026-06-15

### Changed

- Removed the built-in weather widget and core weather API. Weather is now expected to be provided by an optional trusted plugin such as `hll-weather`.
- Docker Compose templates now pass only explicitly supported environment variables into the container instead of forwarding every key from `.env`.

## [0.3.7] - 2026-06-12

### Added

- Added Admin controls to globally show/hide the weather widget from Settings and the hero section from Appearance.
- Added guided Linux and macOS Docker Compose installer scripts with Docker prerequisite checks, interactive deployment prompts, generated `docker-compose.yml`/`.env` files, and README copy/paste install commands.
- Added an optional bundled Nginx reverse-proxy service to the Linux and macOS installers for users without an existing host reverse proxy.
- Added per-user weather visibility preferences for signed-in users.

### Changed

- Updated the dashboard layout so the hero and weather sections span the full content width, removed the current-user tile, and made plugin dashboard sections independently movable.

### Fixed

- Fixed first-admin setup so pressing Enter in modal fields cannot silently close the setup dialog without submitting.

## [0.3.6] - 2026-06-11

### Added

- Added Docker Compose and documentation support for `NODE_EXTRA_CA_CERTS` so deployments can trust internal CA certificates for outbound Node.js HTTPS requests, including trusted plugins.

### Fixed

- Fixed GitHub plugin installs for plugins stored in repository subdirectories, including URLs such as `https://github.com/OWNER/repo/tree/main/plugin-id`, with an explicit-branch fallback when no releases or tags exist.

## [0.3.4] - 2026-06-11

### Fixed

- Fixed preset-based service creation so selected catalog entries import and preserve stored service icons reliably instead of falling back to the generic link icon.
- Fixed bundled local preset refresh on startup so corrected preset metadata, including icon URLs, propagates to existing databases.
- Fixed the bundled qBittorrent preset to use the current Heimdall SVG icon asset.

## [0.3.3] - 2026-06-11

### Added

- Added SVG support for stored service icons, including Heimdall preset imports and downloaded remote icon URLs.

### Fixed

- Fixed service health checks so unresolved or failing hosts persist a down state with a clear error message.
- Fixed the manual health-check toast so failed checks surface as failures instead of always reporting generic completion.
- Fixed the bundled Proxmox preset and the Heimdall preset crawler so apps that declare non-`logo.png` assets import the correct icon.

## [0.3.2] - 2026-06-11

### Added

- Added the running app version and a GitHub repository link to the header.

### Fixed

- Fixed launchpad display controls so metadata visibility and Cards/Compact/List changes render immediately before preference persistence completes.

## [0.3.1] - 2026-06-11

### Fixed

- Fixed the service launchpad metadata toggle so it now works in card, compact, and list views.
- Fixed launchpad metadata visibility so service hostnames remain admin-only, while non-admins can still hide or show tags with the metadata toggle.

## [0.3.0] - 2026-06-11

### Added

- Added `scripts/release-pr.sh` automation script that runs local tests, pushes the branch to GitHub, creates a Pull Request, and configures auto-merge.
- Added comprehensive unit tests for server-side `guardedFetch` (SSRF/DNS rebinding, redirects, and abort handling) in `test/server-fetch.test.js`.
- Added regression test verification for service icon and app asset access control policy in `test/api.test.js`.

### Changed

- Hardened server-side fetches against SSRF and DNS rebinding attacks by resolving hostnames exactly once and pinning connections directly to the IP address (with original Host header and TLS SNI verification).
- Hardened Docker container runtime security by running under the non-root `node` user, dropping capabilities (`cap_drop: ["ALL"]`), preventing privilege escalation (`no-new-privileges: true`), and adding a native Node fetch-based container healthcheck against `/api/healthz`.
- Minimized unauthenticated public settings weather data so exact coordinates are only exposed through authenticated Admin flows.
- Disabled remote Heimdall preset sync by default while keeping bundled local presets available; Admins can opt in to remote presets from catalog settings.
- Clarified backups UI/docs so the stored backup path is an operator note/preferred target, not an automatic scheduler.
- Documented service icons as access-controlled assets and branding images as public login-shell assets.
- Downsized the cards, compact, and list view modes for the service launchpad, tightening margins, paddings, and card heights to make them smaller and cleaner.
- Replaced the "Hide Hostnames" display option with a "Hide/Show Metadata" button (hiding both tags and hostnames in the service cards and favorite tiles), restricted to admin users.

### Security

- Sanitized hero subheading HTML to a small safe formatting subset and stripped unsafe tags, attributes, and non-http(s) links before persistence.
- Hardened TOTP disable so users must reauthenticate with their current password and current TOTP code when 2FA is enabled; disabling 2FA revokes other sessions and is audited.

### Fixed

- Fixed logged-in launchpad preference persistence for layout order, view mode, hidden categories, and metadata visibility, including legacy preference normalization.
- Fixed the launchpad metadata toggle so it works in card, compact, and list views, while keeping service hostnames admin-only and letting non-admins hide or show tags without exposing hostnames.
- Fixed Admin appearance reset by wiring default appearance data into the route module and returning sanitized reset settings.
- Added weather upstream timeouts and a short server-side cache with stale-cache fallback to reduce repeated network work.
- Preserved service health-check settings during config backup restore.

## [0.2.2] - 2026-06-09

### Fixed

- Fixed a ReferenceError crashing the client-side JavaScript on launchpad load due to a missing `controls` variable definition.

## [0.2.1] - 2026-06-09

### Changed

- Made the entire service card/tile in the launcher clickable, opening the service URL in a new tab, except for the action buttons (copy URL, favorite, health check, edit, and delete).
- Improved the service deletion flow by showing a confirmation prompt that includes the specific service name prior to deletion.
- Added a "Hide Hostnames" display option toggle in the launchpad options toolbar to conditionally hide hostname links inside service cards and favorite tiles.

### Fixed

- Fixed the modal close (X) button failing to close the dialog on the profile modal (and potentially others) by absolute-positioning the button with high z-index to prevent overlapping, and explicitly binding a click event handler in JavaScript.




## [0.2.0] - 2026-06-09

### Changed

- Standardized release and Docker image build processes: introduced multi-stage Docker builds, multi-platform Docker images (linux/amd64 and linux/arm64), automated release validation testing in CI/CD, and GHA build caching.
- Update appearance section to allow custom HTML formatting (such as links) in the hero subheading, replacing the basic textarea with a tabbed Visual/Code WYSIWYG editor, increasing the subheading limit to 10,000 characters, and rendering the subheading as HTML in the live preview and launcher.
- Added Service Preset Catalog with offline local top-50 popular presets and remote Heimdall Apps catalog synchronization, including auto-fill service creation, brand color and icon downloads (with SSRF protection), manual catalog update trigger with 60-second rate-limiting, and clear source badge visual indicators.
- Added optional TOTP 2FA for first-admin browser setup and user profiles, including Admin 2FA reset support, strict six-digit code validation, and stronger generated Base32 secrets.
- Added public-release package metadata while keeping Docker/GHCR as the documented distribution path, local development reset/demo seed scripts, and a core API reference.
- Expanded API coverage for anonymous/private read modes, Basic User preferences, Editor vs Admin permissions, CSRF enforcement across mutating routes, backup restore validation, and migration upgrades.
- Improved frontend accessibility and quality coverage with modal focus restoration, keyboard Admin tab navigation, keyboard service ordering controls, reduced-motion/mobile smoke checks, and ARIA tab semantics.
- Completed the P1 maintainability cleanup by splitting backend route modules and frontend browser modules, expanding shared request validators/API response helpers, introducing versioned SQLite migrations, and managing core scheduled jobs through a scheduler.
- Hardened plugin installs with optional SHA-256 verification, manifest-scoped config writes, and clearer public asset/rate-limit documentation.
- Added an explicit SSRF boundary for arbitrary server-side service/icon/asset fetches, including configurable private-network access by role.
- Production startup now fails closed when `SESSION_SECRET` is missing or an example value, and bootstrap admin passwords reject known defaults.
- Browser first-admin setup, private anonymous-read defaults, and neutral weather defaults are now the documented release baseline.
- Docker and deployment docs now prefer official tagged GHCR images at `ghcr.io/TMASoft/home-lab-launcher`, loopback reverse-proxy binding, and explicit validation checks.
- Admin Overview beta readiness checklist items now link directly to deployment, backup, and release documentation.
- Constrained Docker/LXC guidance now keeps bridge networking as the supported default and documents host networking only as a local loopback fallback.
- Release readiness docs now include a versioned release checklist, upgrade-notes template, and dependency-audit gate.
- CI now covers Node.js 20 and 22, validates Compose config, checks release file hygiene, audits production dependencies, and smoke-tests container startup.

### Fixed

- Fixed Lidarr and other service preset saves failing due to missing/broken icon URLs by dynamically discovering actual image assets in the Heimdall preset sync and allowing saves to gracefully succeed and fall back to the default icon on icon download failures (Issue #8).
- Fixed error toasts being obscured/blurred behind modal dialog backdrops by implementing clean, top-layer-safe inline error banners inside the service form, login, bootstrap, profile, and theme preset import modal screens (Issue #9).

## [0.1.0] - 2026-05-14

### Added

- Docker Compose deployment with SQLite persistence.
- Role-based access for Admins, Editors, Basic Users, and optional anonymous read-only access.
- Configurable service launchpad with favorites, drag ordering, bulk actions, import/export, image icons, category filtering, layout preferences, and service health checks.
- Weather widget with configurable location and 5-minute refresh.
- Admin console for users, settings, services, security, backups, logs, plugins, and management-plane health.
- Trusted plugin system with GitHub version pinning, compatibility checks, lifecycle state, config-schema rendering, plugin logs, update/rollback flow, and local development installs.
- Reference News Reader plugin in the companion plugin project.
