# Upgrade Guide

Home Lab Launcher is early/pre-1.0 software. Back up your data volume before upgrading.

## Docker Compose image upgrade

Use the official GHCR image for production-style installs:

```bash
docker compose down
APP_IMAGE=ghcr.io/TMASoft/home-lab-launcher:vX.Y.Z docker compose pull launcher
APP_IMAGE=ghcr.io/TMASoft/home-lab-launcher:vX.Y.Z docker compose up -d --no-build
```

For source checkouts, use `docker compose build --pull && docker compose up -d` instead.

## Before upgrading

1. Download a config backup from **Admin → Backups**.
2. Back up the SQLite database or the Docker volume.
3. Review `CHANGELOG.md` and the release notes for deployment, security, or plugin compatibility changes.
4. Confirm `.env` still contains a strong `SESSION_SECRET` and correct `APP_BASE_URL`.
5. Confirm bootstrap credentials are empty unless you are intentionally doing a first-run non-interactive setup.
6. Confirm database backup handling protects user TOTP secrets before enabling 2FA on upgraded accounts.
7. Review installed plugins after upgrade and remove any that are no longer needed.

## After upgrading

1. Check `docker compose ps` and `docker compose logs --tail=200`.
2. Check `curl -fsS http://localhost:8080/api/healthz` and `/api/bootstrap-status`.
3. Open **Admin → Overview** and review beta readiness checklist links/warnings.
4. Open **Admin → Security** and check effective configuration warnings.
5. Have Admin users enable TOTP 2FA from the profile menu when the deployment is reachable beyond a trusted private LAN.
6. Open **Admin → Plugins** and reload plugins if needed.
7. Review plugin lifecycle states for failed or incompatible plugins.

## Public beta backup-before-upgrade checklist

1. Download a config backup from **Admin → Backups**.
2. Click **Preview restore** with the backup file if you want to validate counts before relying on it.
3. Back up the Docker volume or SQLite database.
4. For source checkouts, run `npm run release:check`, `npm run check`, `npm test`, and `npm run audit:ci` after updating source.
5. Restart with the tagged image or rebuild source, then check `/api/healthz` and container logs.

## Release-note upgrade template

```markdown
### Upgrade notes for vX.Y.Z

- Image: `ghcr.io/TMASoft/home-lab-launcher:vX.Y.Z`
- Backups: download a config backup and back up the Docker volume first.
- Environment: list any required `.env`, reverse-proxy, binding, or bootstrap changes.
- Security: list public-read, plugin trust, SSRF, session, or rate-limit behavior changes.
- Compatibility: list Node/source-checkout support and plugin API/schema changes.
- Validation: run health/bootstrap endpoints and review Admin Overview after restart.
```
