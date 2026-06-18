# Contributing

Thanks for helping improve Home Lab Launcher.

## Development setup

Use Node.js 22. `better-sqlite3` is a native dependency, so local installs need a C/C++ compiler toolchain, Python 3, `make`, and SQLite development headers/libraries. Package names vary by OS; examples include `build-essential python3 make libsqlite3-dev` on Debian/Ubuntu and `base-devel python sqlite` on Arch Linux.

```bash
npm install
npm run check
npm test
npm run dev
```

The app supports Node.js 22 for native development. Docker Compose is the preferred deployment target.

Useful local data commands:

```bash
# Remove ignored development data under ./data
npm run dev:reset

# Add neutral demo services/settings for screenshots and manual UI checks
npm run dev:seed
```

Set `DATA_DIR=/path/to/dev-data` to use a different development database. The reset command refuses to delete data outside this repository unless you intentionally run `node scripts/reset-dev-data.js --force`.

## Code organization

Backend route code is split between `src/server/routes.js` for shared helpers/core wiring and focused files under `src/server/route-modules/` for auth/profile, admin/settings, services/assets, users/preferences, plugin, and preset routes. Shared request coercion lives in `src/server/validation.js`, API response helpers live in `src/server/api-response.js`, and lifecycle-managed recurring work should be registered through `src/server/scheduler.js` rather than raw `setInterval` calls.

Frontend browser code is split into `src/public/core.js` for shared state/API/DOM helpers, `src/public/admin.js` for Admin console rendering/bindings, and `src/public/app.js` for launchpad flow and remaining modal/event wiring. When adding endpoints, prefer shared validators for booleans, URLs, numbers, colors, and bounded text; keep error responses in the `{ "error": "message" }` shape; and add new scheduled work through the scheduler so Admin health can list it and shutdown can stop it cleanly.

## Pull request expectations

- Keep secrets out of commits. Use `.env` locally and `.env.example` for scaffolded configuration.
- Update documentation when behavior changes.
- Add or update tests for API, role, and UI behavior where practical.
- Run `npm run release:check`, `npm run check`, `npm test`, `docker compose config`, and a Docker build before opening a release PR. Alternatively, you can use the release automation script `scripts/release-pr.sh [branch-name]` which automates running the local validation checks, pushing your branch, creating the GitHub Pull Request, and enabling auto-merge.

## Plugin changes

Plugin APIs are still pre-1.0. If a change affects plugin compatibility, update `docs/plugins.md`, `CHANGELOG.md`, and release notes.
