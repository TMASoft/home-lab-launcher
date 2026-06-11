# Changelog

All notable changes to Home Lab Launcher will be documented here.

The project follows a lightweight semantic-versioning style while it is pre-1.0: minor versions may include breaking changes, and patch versions should be safe fixes.

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
