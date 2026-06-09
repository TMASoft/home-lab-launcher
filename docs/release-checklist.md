# Public Beta Release Checklist

Use this checklist before publishing a version tag and again before upgrading a production beta install. Replace `vX.Y.Z` with the exact release tag, for example `v0.1.0`.

## 1. Versioned release gates

- Confirm `package.json` has the intended version and that `CHANGELOG.md` has a release entry or an explicit Unreleased section for the tag.
- Confirm the release tag will publish `ghcr.io/TMASoft/home-lab-launcher:vX.Y.Z` through `.github/workflows/docker-publish.yml`.
- Confirm public docs use neutral examples and do not include private domains, tokens, local filesystem paths, personal weather locations, certificates, or `.env` values.
- Confirm `ROADMAP.md` and `AGENTS.md` remain local-only and excluded from Docker build context.

## 2. Back up data

- Download **Admin → Backups → Download config backup**.
- Back up the SQLite DB or Docker volume.
- If upgrading plugins, export or record plugin versions and checksum expectations.

## 3. Verify deployment configuration

- Confirm Docker Compose v2 is available with `docker compose version`.
- Set a strong `SESSION_SECRET`.
- Prefer browser first-admin setup, or remove environment bootstrap credentials after first login.
- Enable or explicitly defer TOTP 2FA for Admin accounts before shared/public exposure.
- Set `APP_BASE_URL` to the exact browser-facing URL.
- Use `HOST_BIND_IP=127.0.0.1` and `TRUST_PROXY=loopback` when publishing only to a same-host reverse proxy.
- Keep standard Docker bridge networking as the supported default; if a constrained Docker/LXC host requires host networking, use a local-only fallback with `HOST=127.0.0.1` behind a same-host reverse proxy.
- Leave weather location values empty until an operator configures them, or use neutral demo values only for screenshots/tests.
- Review public read-only access.
- Set `SERVER_FETCH_PRIVATE_NETWORK_ACCESS=admin` or `disabled` for shared/public demos; keep `admin-editor` only when Editors are trusted to probe private network URLs.
- Disable local plugin installs in production unless intentionally needed.
- Treat uploaded branding/service images as public assets; remove any sensitive images.
- For plugin installs/updates, prefer release checksums from trusted release notes when available.

## 4. Quality gates

These checks must be passing before publishing. While they are fully automated in GitHub Actions when a release tag is pushed (via `.github/workflows/docker-publish.yml`), it is recommended to run them locally to ensure success before pushing the tag:

```bash
npm run release:check
npm run check
npm test
npm run audit:ci
```

When a tag matching `v*.*.*` is pushed, the release pipeline will:
1. Run the quality gate checks on both Node 20 and 22.
2. Build and push a multi-platform Docker image supporting both `linux/amd64` and `linux/arm64` targets.
3. Automatically apply semantic tags (`vX.Y.Z`, `vX.Y`, `vX`, and `latest`).

For Docker/deployment changes, also validate Compose and smoke-test the container path locally:


```bash
SESSION_SECRET=ci-session-secret-for-compose-validation-only \
BOOTSTRAP_ADMIN_USERNAME= \
BOOTSTRAP_ADMIN_PASSWORD= \
PUBLIC_READ_ENABLED=false \
WEATHER_LOCATION_LABEL= \
WEATHER_LATITUDE= \
WEATHER_LONGITUDE= \
ENABLE_LOCAL_PLUGIN_INSTALL=false \
LOCAL_PLUGIN_HOST_DIR=./local-plugins \
docker compose config
```

CI should also pass JavaScript syntax checks, automated tests, dependency audit, Docker image build, and `/api/healthz` startup smoke tests.

## 5. Image deployment smoke checks

```bash
APP_IMAGE=ghcr.io/TMASoft/home-lab-launcher:vX.Y.Z docker compose pull launcher
APP_IMAGE=ghcr.io/TMASoft/home-lab-launcher:vX.Y.Z docker compose up -d --no-build
docker compose ps
docker compose logs --tail=200
curl -fsS http://localhost:8080/api/healthz
curl -fsS http://localhost:8080/api/bootstrap-status
curl -fsS http://localhost:8080/api/settings/public
```

If deployed behind HTTPS, check the browser-facing `/api/healthz` URL too. Load the UI in a browser, complete first-admin setup if needed, and review **Admin → Overview** beta readiness checklist links and warnings.

## 6. Plugin trust check

- Confirm plugin install/update flows require explicit trusted-code acknowledgement.
- Confirm local plugin install is disabled in production unless explicitly enabled.
- Confirm Editor plugin config writes cannot change Admin-only manifest fields.

## Upgrade notes template

Use this structure in release notes when a tag affects deployment behavior:

```markdown
### Upgrade notes for vX.Y.Z

- Image: `ghcr.io/TMASoft/home-lab-launcher:vX.Y.Z`
- Required action: back up the config and Docker volume before upgrading.
- Deployment changes: describe changes to Compose, reverse proxy, host binding, or required environment variables.
- Security changes: describe new defaults, warnings, plugin trust, SSRF, or public-read behavior.
- Compatibility: note supported Node versions for source checkouts and any plugin/API compatibility changes.
- Smoke checks: run `/api/healthz`, `/api/bootstrap-status`, and review Admin Overview warnings after restart.
```
