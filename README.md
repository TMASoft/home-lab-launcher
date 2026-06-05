# Home Lab Launcher

> A self-hosted, role-aware home portal for service links, weather, user favorites, admin settings, and trusted plugin-powered dashboard sections.

Home Lab Launcher is a small Docker-first web app for turning a home server, lab, or private network into a polished launchpad. It starts simple—service cards and weather—but is designed to grow through installable plugins such as RSS/news, status widgets, inventory panels, or custom household dashboards.

![Status](https://img.shields.io/badge/status-public%20beta%20prep-ffd166?style=flat-square)
![Node](https://img.shields.io/badge/node-20%20%7C%2022-79f2c0?style=flat-square)
![SQLite](https://img.shields.io/badge/storage-SQLite-4de7ff?style=flat-square)
![Docker](https://img.shields.io/badge/deploy-Docker%20Compose-6da8ff?style=flat-square)

## Highlights

- **Configurable service launchpad** — add, edit, duplicate, delete, bulk manage, reorder, group, enable/disable, feature, tag, color, assign emoji/uploaded/downloaded image icons, and enable health checks from the UI.
- **Role-based access** — Admins, Editors, Basic Users, and optional anonymous read-only access.
- **Personal favorites and layout** — logged-in users get saved favorites, favorite ordering, card/list/compact layout preferences, and hidden categories; anonymous users get browser-local preferences.
- **Appearance and theme presets** — Admins can customize global branding, hero copy, colors, fonts, density, radius, favicons, and brand images, then export/import safe shareable theme JSON.
- **Admin console** — manage users, services, app settings, health, effective config, backups/restores, plugins, and audit logs.
- **Weather widget** — configurable by ZIP/city search or manual coordinates; refreshes every 5 minutes.
- **Trusted plugin system** — install pinned plugin versions from GitHub releases/tags, review permissions/compatibility, configure plugins from schemas, inspect plugin logs, and use local plugin development mode.
- **HTTP or HTTPS** — run directly over HTTP or place behind Nginx, Caddy, Traefik, or another reverse proxy.
- **Portable by default** — no baked-in domain names or home-lab-specific assumptions.
- **Security foundations** — CSRF protection, login throttling, secure headers, session revocation, audit logging, log retention, and admin notices.

## Screens and capabilities

The main page includes:

- a service card grid,
- quick favorites,
- current weather,
- a signed-in user menu,
- optional plugin sections, and
- an admin console visible only to Admins.

The UI intentionally hides empty dynamic/plugin sections for regular and anonymous viewers, so the portal stays clean until plugins are installed.

## Public beta quick start

This beta is intended for self-hosters who can manage a Docker Compose service and review security warnings before exposing it beyond a private LAN. After first login, open **Admin → Overview** and complete the beta readiness checklist.

## Quick start

### 1. Clone and configure

```bash
git clone https://github.com/YOUR-ORG/home-lab-launcher.git
cd home-lab-launcher
cp .env.example .env
```

Edit `.env` before first start. At minimum, set a strong session secret and make `APP_BASE_URL` match the URL users will open in a browser:

```bash
# One portable way to generate a secret on most Linux/macOS hosts:
openssl rand -hex 48
```

```env
SESSION_SECRET=replace-with-a-long-random-string
APP_BASE_URL=http://localhost:8080
```

Choose one first-admin setup path:

- **Browser setup, recommended for most installs:** leave `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` empty or remove them from `.env`; the first page load prompts you to create the Admin account.
- **Environment bootstrap:** set `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` before the first start when you need non-interactive setup. Change or remove the bootstrap password after first login.

### 2. Start with Docker Compose

For a tagged public release, prefer the published image and skip a local build:

Replace `OWNER` with the GitHub owner that published the package.

```bash
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:v0.1.0 docker compose pull launcher
APP_IMAGE=ghcr.io/OWNER/home-lab-launcher:v0.1.0 docker compose up -d --no-build
docker compose ps
```

When developing from a source checkout, build locally instead:

```bash
docker compose up --build -d
docker compose ps
```

Open:

```text
http://localhost:8080
```

Validate the anonymous health endpoint:

```bash
curl -fsS http://localhost:8080/api/healthz
curl -fsS http://localhost:8080/api/bootstrap-status
```

`/api/healthz` returns only `{ ok, version, uptimeSeconds }`. `/api/bootstrap-status` reports whether first-admin setup is still needed.

### 3. Optional port and reverse-proxy binding

The container listens on port `8080` internally. To use a different host port, set `HOST_PORT` and update `APP_BASE_URL`:

```env
HOST_PORT=9090
APP_BASE_URL=http://localhost:9090
```

When the launcher sits behind Nginx, Caddy, Traefik, or another reverse proxy on the same host, bind the published port to loopback only:

```env
HOST_BIND_IP=127.0.0.1
HOST_PORT=8080
TRUST_PROXY=loopback
APP_BASE_URL=https://launcher.example.test
```

`HOST` controls the interface the Node process listens on inside the container and normally stays at `0.0.0.0`. In constrained Docker/LXC environments where normal port publishing is unavailable and you intentionally use host networking, set `HOST=127.0.0.1` so the app listens on loopback only.

## Launchpad personalization and health

The launchpad supports card, compact grouped, and list views. Logged-in users can save their layout preference, reorder favorites, and hide categories. Anonymous visitors get the same preferences stored locally in their browser when public read-only access is enabled.

Editors and Admins can enable HTTP health checks per service, optionally override the health-check URL, set the check interval, and trigger manual checks. Cards show the latest status, last-check timing, response time, and error details where available. These checks are server-side fetches; see the SSRF notes below before granting Editor access in shared or internet-exposed deployments.

## Service icons

Service cards can use either a simple emoji/text icon or an image. When an Editor/Admin pastes an `http://` or `https://` image URL into the icon field, the launcher downloads and stores the image locally instead of hotlinking it. Editors/Admins can also choose a local image file from the service form.

Supported image formats are JPEG, PNG, GIF, and WebP. Animated GIF/WebP files and transparent images are preserved. Icon uploads/downloads are limited to 5 MiB.

## Appearance customization and theme packs

Admins control the global look of the launcher from **Admin console → Appearance**. Basic Users keep personal launchpad preferences such as favorites, favorite order, view mode, and hidden categories, but cannot change the site-wide theme.

Appearance settings include:

- site/app name, browser title, header brand text/subtitle, and initials fallback,
- favicon, brand icon, and optional hero/header image assets,
- hero eyebrow, heading, and subheading copy,
- dark/light/system mode,
- controlled theme colors, fonts, density, and corner radius.

Branding assets are separate from service icons. App assets are stored under the launcher data directory and served from `/api/app-assets/:filename`; service icons continue to use `/api/service-icons/:filename`. Supported app asset formats are JPEG, PNG, GIF, and WebP up to 5 MiB. SVG is intentionally rejected for app assets in this release because unsafe SVG content can include script-like behavior.

Admins can save the current appearance as a preset, apply a preset, duplicate/delete presets, export a preset, or import one. Preset exports are designed for safe sharing and contain only appearance data:

```json
{
  "format": "home-lab-launcher-theme-v1",
  "name": "Midnight Lab",
  "description": "Dark blue theme for network dashboards",
  "appearance": {
    "version": 1,
    "brand": {
      "appName": "Home Lab Launcher",
      "pageTitle": "Home Lab Launcher",
      "brandText": "Home Lab Launcher",
      "brandSubtitle": "Home lab control plane",
      "brandMarkText": "HL",
      "faviconUrl": "",
      "brandIconUrl": "",
      "heroImageUrl": ""
    },
    "hero": {
      "eyebrow": "Home lab operations",
      "heading": "Launch and manage your internal services.",
      "subheading": "A role-aware launcher for the tools, dashboards, and dynamic sections that make up your home lab."
    },
    "theme": {
      "mode": "dark",
      "fontFamily": "system",
      "density": "comfortable",
      "radius": "soft",
      "colors": {
        "primary": "#8fd3ff"
      }
    }
  }
}
```

Theme preset JSON never includes users, services, sessions, secrets, plugin configuration, logs, or backups. Imported presets are validated and sanitized before they can be applied.

## User roles

| Role | Can view | Favorites | Manage services | Plugin settings | Install/remove plugins | Users/app settings/logs |
| --- | --- | --- | --- | --- | --- | --- |
| **Admin** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Editor** | Yes | Yes | Yes | Editor-safe plugin settings | No | No |
| **Basic User** | Yes | Yes | No | User-safe plugin preferences, when exposed | No | No |
| **Anonymous** | Optional | Browser-local only | No | No | No | No |

Admins can choose whether anonymous visitors may view the portal. Disable anonymous read-only access in **Admin console → Settings** to require login for all page views.

## Admin console

Logged-in Admins see an **Admin** link in the top navigation. The console includes:

- **Overview** — service/user/plugin/log counts, runtime information, configuration warnings, and admin notices.
- **Settings** — app name, base URL, public read-only access, and weather settings.
- **Appearance** — branding, hero content, app assets, color/font/density controls, live preview, default restore, and theme preset import/export.
- **Services** — export/import service JSON, drag-and-drop ordering, duplicate services, image/emoji icons, color/icon presets, health-check settings, and bulk enable/disable/feature/delete actions.
- **Users** — create users, change roles, reset passwords, and delete users.
- **Security** — active-session count, CSRF/header status, deployment warnings, effective configuration, reverse-proxy/HTTPS status, plugin health, weather-provider status, and scheduled job status.
- **Backups** — download a portable configuration backup, export the SQLite database, restore settings/services from a config backup, and record the desired scheduled backup location.
- **Plugins** — discover GitHub versions, install pinned plugin releases/tags, enable/disable, and remove plugins.
- **Logs** — filtered audit log entries for login, settings, user, service, weather, plugin, backup, and management actions, with JSON export, retention policy, and pruning controls.

Users access profile actions from the username dropdown in the header. The profile menu includes password changes, active session review, session revocation, and logout.

## Configuration

Most runtime settings are environment variables on first boot, then editable in the Admin console where applicable.

| Variable | Purpose | Default/example |
| --- | --- | --- |
| `HOST_PORT` | Host port published by Docker Compose | `8080` |
| `HOST_BIND_IP` | Host interface for the published Docker port; use `127.0.0.1` behind a local reverse proxy | `0.0.0.0` |
| `HOST` | Interface the Node process listens on inside the container/native process | `0.0.0.0` |
| `TRUST_PROXY` | Express reverse-proxy trust setting. Keep `false` for direct exposure; use `loopback` or `1` behind a trusted same-host/single reverse proxy | `false` |
| `PORT` | App port inside the container or native Node process | `8080` |
| `APP_NAME` | Initial displayed application name | `Home Lab Launcher` |
| `APP_BASE_URL` | External URL users open in a browser; set this to the reverse-proxy HTTPS URL when proxied | `http://localhost:8080` |
| `SESSION_SECRET` | Required session signing secret; generate a long random value before deployment | Change this |
| `DATA_DIR` | SQLite/session/plugin data directory | `/app/data` in Docker |
| `PLUGIN_DIR` | Installed plugin directory | `/app/data/plugins` |
| `BOOTSTRAP_ADMIN_USERNAME` | Optional initial Admin username; omit for browser first-admin setup | empty |
| `BOOTSTRAP_ADMIN_PASSWORD` | Optional initial Admin password; omit for browser first-admin setup | empty |
| `PUBLIC_READ_ENABLED` | Initial anonymous read-only access | `false` |
| `WEATHER_LOCATION_LABEL` | Initial weather label; leave empty until configured in Admin settings | empty |
| `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` | Initial weather coordinates; leave empty until configured in Admin settings | empty |
| `WEATHER_UNITS` | `fahrenheit` or `celsius` | `fahrenheit` |
| `LOG_RETENTION_DAYS` | Initial audit-log retention window | `90` |
| `SCHEDULED_BACKUP_LOCATION` | Optional operator note for desired backup destination | empty |
| `SERVER_FETCH_PRIVATE_NETWORK_ACCESS` | Which roles may make arbitrary server-side fetches to private, loopback, link-local, or reserved addresses through service health checks and remote image downloads. Use `admin-editor`, `admin`, or `disabled` | `admin-editor` |

Runtime data is stored in SQLite in the Docker volume `launcher-data` unless you override `DATA_DIR`. Keep `.env`, database files, plugin installs, and private certificates out of Git.

## HTTPS and domains

Home Lab Launcher does **not** issue or manage certificates itself. This keeps the app portable and avoids security-sensitive certificate handling in the application process.

Supported deployment styles:

- direct HTTP, such as `http://server-ip:8080`,
- HTTPS behind Nginx with your own certificate,
- HTTPS behind Caddy with ACME, or
- any other reverse proxy that forwards to the launcher container.

See [docs/deployment.md](docs/deployment.md) for examples.

## Plugin system

Plugins are trusted Admin-installed code. The Admin console shows lifecycle state, compatibility, permissions, installed hash, config schema fields, logs, update discovery, and release-note previews. A plugin can add:

- backend API routes,
- SQLite tables/migrations,
- scheduled jobs,
- static frontend assets, and
- dashboard sections.

The plugin manager supports GitHub repository URLs and version discovery from releases/tags. Admins choose an explicit version to install. Updates are manual, show release notes when available, and roll back to the previous installed plugin if the new version fails to load. Development installs from a local filesystem path are allowed when `NODE_ENV` is not `production` or `ENABLE_LOCAL_PLUGIN_INSTALL=true`. In Docker, mount the host plugin directory with `LOCAL_PLUGIN_HOST_DIR` and install using the container path such as `/app/local-plugins/news`; host paths under `LOCAL_PLUGIN_HOST_DIR` are auto-mapped when possible.

See [docs/plugins.md](docs/plugins.md) for the manifest and API reference.

### Example plugin

The first plugin lives separately at:

```text
home-lab-launcher-plugins/news
```

It implements an optional RSS/news dashboard section with feed management, folders, per-feed refresh status, cleanup/retention, and OPML import/export. See that plugin’s README for packaging notes.

## Development

Native development should use an active Node.js LTS release supported by `better-sqlite3` and the Docker image. This beta supports Node.js 20 and 22; newer current/non-LTS releases may not have compatible native SQLite bindings yet.

```bash
npm install
npm run check
npm run dev
```

Useful commands:

```bash
# Validate JavaScript syntax
npm run check

# Build and run with Docker from source
docker compose up --build

# Validate release hygiene before publishing
npm run release:check

# Inspect logs
docker compose logs -f launcher
```

## Security notes

- Change `SESSION_SECRET` before deployment.
- Change or remove the bootstrap password after first login.
- CSRF protection is enabled for mutating API routes after login.
- Failed logins are rate-limited and audited.
- Security headers are set by the application; still use HTTPS for real deployments.
- Keep `TRUST_PROXY=false` for direct exposure. Set `TRUST_PROXY=loopback` or `TRUST_PROXY=1` only when a trusted reverse proxy supplies forwarded headers.
- Users can revoke other active sessions from their profile.
- Admins can export logs, set retention, prune old audit events, and review management-plane notices.
- Plugins are trusted Admin-installed code and are not sandboxed. Install/update only plugins from sources you trust; the UI requires an explicit trust acknowledgement.
- Remote service/branding image fetches, URL tests, and service health checks are server-side fetches. By default, Admins and Editors may target private, loopback, link-local, and reserved addresses for home-lab use. Set `SERVER_FETCH_PRIVATE_NETWORK_ACCESS=admin` in shared deployments, or `disabled` for internet-exposed demos where no operator should use the launcher as an internal-network HTTP client.
- The SSRF guard resolves each requested host before fetching and re-checks redirect targets. It blocks private-network destinations for roles not allowed by `SERVER_FETCH_PRIVATE_NETWORK_ACCESS`, uses timeouts and size limits for image downloads, and rejects SVG assets. This is a defense-in-depth boundary, not a browser sandbox; trusted plugins still run server-side code and can make their own network requests.
- Keep `.env`, SQLite databases, plugin installs, and private certificates out of Git.
- Put the launcher behind HTTPS if credentials traverse an untrusted network.

## Project status

This project is in early development. The core app is functional, but plugin APIs and schemas may still change before a stable release. Public release work is tracked through GitHub issues, milestones, and `CHANGELOG.md`.

## Screenshots

Screenshots and GIFs should be added under `docs/assets/` before a formal tagged public release. Suggested captures are listed in `docs/assets/README.md`: launchpad, service edit, appearance customization, admin overview, and mobile view.

## License

MIT — see [LICENSE](LICENSE).
