# Deployment Guide

Home Lab Launcher is designed to run anywhere Docker Compose can run. It can be exposed directly over HTTP for private LAN use or placed behind a reverse proxy for HTTPS.

## Prerequisites

- Docker Engine installed and running.
- Docker Compose v2 available as `docker compose`.
- A writable application directory containing the project source and `.env` file.

On some Ubuntu installs, Compose v2 is packaged as `docker-compose-v2` rather than `docker-compose-plugin`:

```bash
sudo apt-get update
sudo apt-get install docker-compose-v2
```

Verify before deploying:

```bash
docker --version
docker compose version
```

## Docker Compose quick start

Replace `OWNER` with the GitHub owner that published the package.

```bash
cp .env.example .env
# edit .env
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:v0.1.0 docker compose pull launcher
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:v0.1.0 docker compose up -d --no-build
docker compose ps
```

For development from a source checkout, use `docker compose up --build -d` instead.

The default Compose file:

- can use a published image through `APP_IMAGE` or build the local app image for source checkouts,
- stores runtime data in the `launcher-data` volume,
- exposes `HOST_PORT` on `HOST_BIND_IP`, defaulting to `0.0.0.0:8080`, and
- keeps the container listening on port `8080` internally.

Minimum production-minded values:

```env
HOST_PORT=8080
APP_BASE_URL=http://localhost:8080
SESSION_SECRET=replace-with-a-long-random-string
PUBLIC_READ_ENABLED=false
```

Generate a session secret with a password manager or a command such as:

```bash
openssl rand -hex 48
```

## Data persistence

By default, Docker stores application data in the named volume:

```text
home-lab-launcher_launcher-data
```

That volume contains:

- SQLite application data,
- session data,
- installed plugin code, and
- plugin-created data.

Back up this volume if the launcher is important to your environment. Do not delete the `launcher-data` volume unless you intentionally want to reset all data. See `docs/examples/backup-restore.md` for Docker volume backup and restore snippets.

## Deployment patterns

### Direct HTTP on a private LAN

For a private LAN, HTTP may be acceptable:

```env
HOST_PORT=8080
APP_BASE_URL=http://192.168.1.50:8080
```

Then run the published image or build from source as shown in the quick start.

Open:

```text
http://192.168.1.50:8080
```

### Loopback-only behind a reverse proxy

When Nginx, Caddy, Traefik, or another reverse proxy runs on the same host, publish the launcher only on loopback and set `APP_BASE_URL` to the browser-facing HTTPS URL:

```env
HOST_BIND_IP=127.0.0.1
HOST_PORT=8080
TRUST_PROXY=loopback
SERVER_FETCH_PRIVATE_NETWORK_ACCESS=admin-editor
APP_BASE_URL=https://launcher.example.test
```

The proxy should forward to:

```text
http://127.0.0.1:8080
```

`TRUST_PROXY` controls whether Express trusts `X-Forwarded-*` headers. Keep it `false` when exposing the app directly. Use `TRUST_PROXY=loopback` for a same-host reverse proxy, `TRUST_PROXY=1` for a single trusted proxy hop, or an explicit Express trust-proxy subnet string for advanced multi-proxy deployments.

`HOST` normally remains unset or `0.0.0.0` so the app can receive traffic from Docker networking. Only set `HOST=127.0.0.1` when you intentionally run the container with host networking or run the Node app natively and want the process itself bound to loopback. The optional override in `docs/examples/compose.loopback.yml` encodes the loopback published-port setting for same-host reverse proxies.

### Nginx reverse proxy with a user-provided certificate

Use this when you already have a certificate from an internal CA, public CA, or another certificate process.

```nginx
server {
  listen 80;
  server_name launcher.example.test;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name launcher.example.test;

  ssl_certificate /path/to/fullchain.crt;
  ssl_certificate_key /path/to/private.key;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
  }
}
```

Set:

```env
HOST_BIND_IP=127.0.0.1
TRUST_PROXY=loopback
APP_BASE_URL=https://launcher.example.test
```

### Caddy with automatic ACME certificates

If your domain and network can satisfy ACME challenges, Caddy is the simplest HTTPS option:

```caddyfile
launcher.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Set:

```env
HOST_BIND_IP=127.0.0.1
TRUST_PROXY=loopback
APP_BASE_URL=https://launcher.example.com
```

### Private/internal certificate deployments

For internal-only domains, use your preferred CA workflow, then proxy to the app with Nginx, Caddy, Traefik, or another reverse proxy.

The launcher itself does not need to know certificate paths. It only needs `APP_BASE_URL` to reflect the URL users open.

## First admin bootstrap

There are two supported approaches.

### Browser bootstrap, recommended

Leave both bootstrap values empty or remove them from `.env`:

```env
BOOTSTRAP_ADMIN_USERNAME=
BOOTSTRAP_ADMIN_PASSWORD=
```

On first page load, the UI prompts you to create the first Admin. This avoids storing an initial password in the project directory.

### Environment bootstrap

Set these before the first app start when you need non-interactive setup:

```env
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=replace-this-password
```

The app creates the Admin if the users table is empty. Change the password after first login and remove bootstrap credentials from `.env` once setup is complete.

## Validation checks

Before putting a reverse proxy or DNS in front of the app, verify the local container:

```bash
docker compose ps
curl -fsS http://localhost:8080/api/healthz
curl -fsS http://localhost:8080/api/bootstrap-status
```

After configuring HTTPS, verify the browser-facing URL:

```bash
curl -k -fsS https://launcher.example.test/api/healthz
```

Open the UI in a browser and complete first-admin setup if `/api/bootstrap-status` reports `needsBootstrap: true`.

## Upgrades

For now, update by pulling new source and rebuilding:

```bash
docker compose down
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:v0.1.1 docker compose pull launcher
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:v0.1.1 docker compose up -d --no-build

# Or, for source checkouts:
# docker compose build --pull
# docker compose up -d
```

Do not delete the `launcher-data` volume unless you intentionally want to reset all data.

## Troubleshooting

### Compose v2 is missing

If `docker compose version` fails, install the Compose v2 package for your distribution. On Ubuntu, try `docker-compose-v2` if `docker-compose-plugin` is unavailable.

### Port already in use

If startup fails because `8080` is already in use, either stop the conflicting service or change `HOST_PORT`:

```env
HOST_PORT=9090
APP_BASE_URL=http://localhost:9090
```

### Reverse proxy redirects or cookies look wrong

Confirm `APP_BASE_URL` is the exact URL users open, including `https://` when TLS terminates at the proxy. Set `TRUST_PROXY` only for trusted proxy hops, and keep `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` in your proxy config.

### Docker/LXC port publishing limitations

Some constrained LXC or nested Docker environments cannot create normal published ports. Prefer a standard Docker host when possible. If you intentionally use host networking as a workaround, set `HOST=127.0.0.1`, keep the app behind a local reverse proxy, and document that override outside the public Compose file.

### Container logs

```bash
docker compose logs -f launcher
```

### Check container state

```bash
docker compose ps
```

### Validate API health manually

```bash
curl -fsS http://localhost:8080/api/healthz
curl -fsS http://localhost:8080/api/bootstrap-status
curl -fsS http://localhost:8080/api/settings/public
```

### Database migrations and scheduled jobs

Startup applies forward-only SQLite schema migrations before seeding defaults. Applied migration IDs are recorded in the `schema_migrations` table and mirrored to SQLite `PRAGMA user_version`, so upgrades can be inspected from a database export or the SQLite CLI. Back up the `launcher-data` volume before downgrading or manually editing the database.

The built-in service-health checker is registered as a lifecycle-managed scheduled job. Admins can inspect core scheduled jobs, plugin scheduled jobs, last run state, and next run times from **Admin → Security/Health** or `/api/admin/health`. On process shutdown, core scheduled jobs are stopped before the HTTP server exits.

### Management-plane checks

Admins can inspect health, warnings, effective configuration, reverse-proxy/HTTPS status, storage size, active sessions, plugin health, scheduled jobs, logs, backups, and service-management tools from the Admin console. The same data is exposed through authenticated APIs such as `/api/admin/health`, `/api/admin/config`, `/api/admin/notices`, `/api/admin/logs`, and `/api/admin/backup`. Admins can also export the SQLite database with `/api/admin/database/export`, export logs with `/api/admin/logs/export`, and restore settings/services from a configuration backup with `/api/admin/restore`.

### CSRF and sessions

Mutating API requests after login require the `X-CSRF-Token` header returned by `/api/auth/session` or `/api/auth/login`. The bundled frontend handles this automatically. If you build external clients, fetch a session first and reuse the returned token.

### Native SQLite module errors

If you see a native module or GLIBC error, make sure `node_modules/` is not copied from the host into the image. The repository includes `.dockerignore` for this reason. Rebuild with:

```bash
docker compose build --no-cache launcher
```

## Public beta hardening notes

Before exposing the launcher outside a private LAN, configure HTTPS at the reverse proxy, set `APP_BASE_URL` to the external HTTPS URL, use a long random `SESSION_SECRET`, remove default bootstrap credentials, and review whether anonymous read-only access should remain enabled. The Admin Overview shows beta readiness warnings for these items.

Remote service icons, branding images, URL tests, and service health checks are fetched by the server. This is useful in home labs because operators often monitor private dashboards, but it is also an SSRF boundary: a user who can trigger these fetches can ask the launcher host to contact network locations the user may not be able to reach directly.

`SERVER_FETCH_PRIVATE_NETWORK_ACCESS` controls who may target private, loopback, link-local, carrier-grade NAT, documentation, multicast, or reserved IP ranges after DNS resolution. The default `admin-editor` preserves normal home-lab behavior. Use `admin` when Editors should manage cards but not probe internal networks, and use `disabled` for public demos or other deployments where arbitrary internal-network fetches are not acceptable. Redirect targets are checked before following them. Image downloads still have timeouts and 5 MiB limits, and SVG uploads/downloads are intentionally rejected for service and branding images. Trusted plugins are outside this SSRF boundary because plugins are Admin-installed server-side code.


### Public assets and login-required portals

Uploaded branding assets and service icons are intentionally served from `/api/app-assets/:filename` and `/api/service-icons/:filename` even when anonymous read-only access is disabled. This lets the login page, browser favicon, and already-rendered portal chrome display configured imagery without granting access to services or settings. Treat uploaded images as public web assets and do not store secrets, private screenshots, certificates, or sensitive diagrams there.

### Login throttling

Failed login attempts are tracked in SQLite by client IP and username for a 15-minute window, so counters survive process restarts and are shared by app workers using the same database. This is an application safety net, not a replacement for reverse-proxy rate limits, fail2ban, or WAF controls when the launcher is exposed beyond a private LAN.

## Content Security Policy note

The app sets a restrictive CSP and continues to allow `style-src 'unsafe-inline'` for beta because the vanilla UI applies saved theme variables and a few runtime preview styles directly. Script sources remain `self` only, object embedding is disabled, and frame ancestors are blocked.
