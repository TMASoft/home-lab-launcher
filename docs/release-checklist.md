# Public Beta Release Checklist

Run this before cutting a public beta release.

1. Back up data.
   - Download **Admin → Backups → Download config backup**.
   - Back up the SQLite DB or Docker volume.
2. Verify configuration.
   - Confirm Docker Compose v2 is available with `docker compose version`.
   - Set a strong `SESSION_SECRET`.
   - Prefer browser first-admin setup, or remove environment bootstrap credentials after first login.
   - Set `APP_BASE_URL` to the exact browser-facing URL.
   - Use `HOST_BIND_IP=127.0.0.1` and `TRUST_PROXY=loopback` when publishing only to a same-host reverse proxy.
   - Review public read-only access.
   - Set `SERVER_FETCH_PRIVATE_NETWORK_ACCESS=admin` or `disabled` for shared/public demos; keep `admin-editor` only when Editors are trusted to probe private network URLs.
   - Disable local plugin installs in production unless intentionally needed.
   - Treat uploaded branding/service images as public assets; remove any sensitive images.
   - For plugin installs/updates, prefer release checksums from trusted release notes when available.
3. Quality gates.
   - `npm run release:check`
   - `npm run check`
   - `npm test`
   - `npm audit --omit=dev --audit-level=high`
4. Rebuild and restart Docker.
   - `docker compose config`
   - Prefer a tagged image: `APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:vX.Y.Z docker compose up -d --no-build`
   - Or build a source checkout: `docker compose up --build -d`
   - `docker compose ps`
   - `docker compose logs --tail=200`
5. Smoke checks.
   - `curl -fsS http://localhost:8080/api/healthz`
   - `curl -fsS http://localhost:8080/api/bootstrap-status`
   - `curl -fsS http://localhost:8080/api/settings/public`
   - If deployed behind HTTPS, check the browser-facing `/api/healthz` URL too.
   - Load the UI in a browser and complete first-admin setup if needed.
   - Check **Admin → Overview** beta readiness warnings.
6. Plugin trust check.
   - Confirm plugin install/update flows require explicit trusted-code acknowledgement.
   - Confirm local plugin install is disabled in production unless explicitly enabled.
   - Confirm Editor plugin config writes cannot change Admin-only manifest fields.
