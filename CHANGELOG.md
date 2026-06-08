# Changelog

All notable changes to Home Lab Launcher will be documented here.

The project follows a lightweight semantic-versioning style while it is pre-1.0: minor versions may include breaking changes, and patch versions should be safe fixes.

## Unreleased

### Changed

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

## [0.1.0] - 2026-05-14

### Added

- Docker Compose deployment with SQLite persistence.
- Role-based access for Admins, Editors, Basic Users, and optional anonymous read-only access.
- Configurable service launchpad with favorites, drag ordering, bulk actions, import/export, image icons, category filtering, layout preferences, and service health checks.
- Weather widget with configurable location and 5-minute refresh.
- Admin console for users, settings, services, security, backups, logs, plugins, and management-plane health.
- Trusted plugin system with GitHub version pinning, compatibility checks, lifecycle state, config-schema rendering, plugin logs, update/rollback flow, and local development installs.
- Reference News Reader plugin in the companion plugin project.
