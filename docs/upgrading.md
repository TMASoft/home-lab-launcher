# Upgrade Guide

Home Lab Launcher is early/pre-1.0 software. Back up your data volume before upgrading.

## Docker Compose upgrade

```bash
docker compose down
docker compose pull || true
docker compose build --pull
docker compose up -d
```

If you run from a published image in the future, replace the build step with an image pull.

## Before upgrading

1. Download a config backup from **Admin → Backups**.
2. Back up the SQLite database or the Docker volume.
3. Review `CHANGELOG.md` for breaking changes.
4. Confirm `.env` still contains a strong `SESSION_SECRET` and correct `APP_BASE_URL`.

## After upgrading

1. Open **Admin → Security** and check warnings.
2. Open **Admin → Plugins** and reload plugins.
3. Review plugin lifecycle states for failed or incompatible plugins.
