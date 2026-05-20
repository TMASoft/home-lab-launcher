# Deployment Guide

Home Lab Launcher is designed to run anywhere Docker Compose can run. It can be exposed directly over HTTP for private LAN use or placed behind a reverse proxy for HTTPS.

## Docker Compose quick start

```bash
cp .env.example .env
# edit .env
docker compose up --build -d
```

The default Compose file:

- builds the local app image,
- stores runtime data in the `launcher-data` volume,
- exposes `HOST_PORT` on the host, defaulting to `8080`, and
- keeps the container listening on port `8080` internally.

```env
HOST_PORT=8080
APP_BASE_URL=http://localhost:8080
SESSION_SECRET=replace-with-a-long-random-string
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

Back up this volume if the launcher is important to your environment.

## HTTP-only deployment

For a private LAN, HTTP may be acceptable:

```env
HOST_PORT=8080
APP_BASE_URL=http://192.168.1.50:8080
```

Then run:

```bash
docker compose up --build -d
```

Open:

```text
http://192.168.1.50:8080
```

## Nginx reverse proxy with a user-provided certificate

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
  }
}
```

Set:

```env
APP_BASE_URL=https://launcher.example.test
```

## Caddy with automatic ACME certificates

If your domain and network can satisfy ACME challenges, Caddy is the simplest HTTPS option:

```caddyfile
launcher.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Set:

```env
APP_BASE_URL=https://launcher.example.com
```

## Private/internal certificate deployments

For internal-only domains, use your preferred CA workflow, then proxy to the app with Nginx, Caddy, Traefik, or another reverse proxy.

The launcher itself does not need to know certificate paths. It only needs `APP_BASE_URL` to reflect the URL users open.

## First admin bootstrap

There are two supported approaches.

### Environment bootstrap

Set these before the first app start:

```env
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=replace-this-password
```

The app creates the Admin if the users table is empty.

### Browser bootstrap

Leave both values empty. On first page load, the UI prompts you to create the first Admin.

## Upgrades

For now, update by pulling new source and rebuilding:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

Do not delete the `launcher-data` volume unless you intentionally want to reset all data.

## Troubleshooting

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

Remote service icons and branding images are fetched by the server for Admin/Editor actions with timeouts and size limits. Treat arbitrary remote URLs as trusted-operator inputs. SVG uploads are intentionally rejected for service and branding images.

## Content Security Policy note

The app sets a restrictive CSP and continues to allow `style-src 'unsafe-inline'` for beta because the vanilla UI applies saved theme variables and a few runtime preview styles directly. Script sources remain `self` only, object embedding is disabled, and frame ancestors are blocked.
