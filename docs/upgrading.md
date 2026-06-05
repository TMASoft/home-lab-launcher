# Upgrade Guide

Home Lab Launcher is early/pre-1.0 software. Back up your data volume before upgrading.

## Docker Compose upgrade

```bash
docker compose down
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:vX.Y.Z docker compose pull launcher
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:vX.Y.Z docker compose up -d --no-build
```

For source checkouts, use `docker compose build --pull && docker compose up -d` instead.

## Before upgrading

1. Download a config backup from **Admin → Backups**.
2. Back up the SQLite database or the Docker volume.
3. Review `CHANGELOG.md` for breaking changes.
4. Confirm `.env` still contains a strong `SESSION_SECRET` and correct `APP_BASE_URL`.

## After upgrading

1. Open **Admin → Security** and check warnings.
2. Open **Admin → Plugins** and reload plugins.
3. Review plugin lifecycle states for failed or incompatible plugins.


## Public beta backup-before-upgrade checklist

1. Download a config backup from **Admin → Backups**.
2. Click **Preview restore** with the backup file if you want to validate counts before relying on it.
3. Back up the Docker volume or SQLite database.
4. For source checkouts, run `npm run release:check`, `npm run check`, `npm test`, and `npm audit --omit=dev --audit-level=high` after updating source.
5. Restart with the tagged image or rebuild source, then check `/api/healthz` and container logs.
