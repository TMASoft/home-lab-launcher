# Public Beta Release Checklist

Run this before cutting a public beta release.

1. Back up data.
   - Download **Admin → Backups → Download config backup**.
   - Back up the SQLite DB or Docker volume.
2. Verify configuration.
   - Set a strong `SESSION_SECRET`.
   - Remove default bootstrap credentials.
   - Set `APP_BASE_URL` to the public URL.
   - Review public read-only access.
   - Disable local plugin installs in production unless intentionally needed.
3. Quality gates.
   - `npm run check`
   - `npm test`
   - `npm audit --omit=dev --audit-level=high`
4. Rebuild and restart Docker.
   - `docker compose up --build -d`
   - `docker compose ps`
   - `docker compose logs --tail=200`
5. Smoke checks.
   - `curl -fsS http://localhost:8080/api/healthz`
   - `curl -fsS http://localhost:8080/api/bootstrap-status`
   - `curl -fsS http://localhost:8080/api/settings/public`
   - Load the UI in a browser.
   - Check **Admin → Overview** beta readiness warnings.
6. Plugin trust check.
   - Confirm plugin install/update flows require explicit trusted-code acknowledgement.
   - Confirm local plugin install is disabled in production unless explicitly enabled.
