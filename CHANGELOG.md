# Changelog

All notable changes to Home Lab Launcher will be documented here.

The project follows a lightweight semantic-versioning style while it is pre-1.0: minor versions may include breaking changes, and patch versions should be safe fixes.

## Unreleased

### Changed

- Added public-release package metadata while keeping Docker/GHCR as the documented distribution path, local development reset/demo seed scripts, and a core API reference.
- Expanded API coverage for anonymous/private read modes, Basic User preferences, Editor vs Admin permissions, CSRF enforcement across mutating routes, backup restore validation, and migration upgrades.
- Improved frontend accessibility and quality coverage with modal focus restoration, keyboard Admin tab navigation, keyboard service ordering controls, reduced-motion/mobile smoke checks, and ARIA tab semantics.
- Completed the P1 maintainability cleanup by splitting backend route modules and frontend browser modules, expanding shared request validators/API response helpers, introducing versioned SQLite migrations, and managing core scheduled jobs through a scheduler.
- Hardened plugin installs with optional SHA-256 verification, manifest-scoped config writes, and clearer public asset/rate-limit documentation.
- Added an explicit SSRF boundary for arbitrary server-side service/icon/asset fetches, including configurable private-network access by role.
- Production startup now fails closed when `SESSION_SECRET` is missing or an example value, and bootstrap admin passwords reject known defaults.
- Browser first-admin setup, private anonymous-read defaults, and neutral weather defaults are now the documented release baseline.
- Docker and deployment docs now prefer tagged GHCR images, loopback reverse-proxy binding, and explicit validation checks.
- CI now covers Node.js 20 and 22, validates Compose config, checks release file hygiene, and smoke-tests container startup.

## [0.1.0] - 2026-05-14

### Added

- Docker Compose deployment with SQLite persistence.
- Role-based access for Admins, Editors, Basic Users, and optional anonymous read-only access.
- Configurable service launchpad with favorites, drag ordering, bulk actions, import/export, image icons, category filtering, layout preferences, and service health checks.
- Weather widget with configurable location and 5-minute refresh.
- Admin console for users, settings, services, security, backups, logs, plugins, and management-plane health.
- Trusted plugin system with GitHub version pinning, compatibility checks, lifecycle state, config-schema rendering, plugin logs, update/rollback flow, and local development installs.
- Reference News Reader plugin in the companion plugin project.
