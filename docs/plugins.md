# Plugin Development Guide

Plugins let Home Lab Launcher add optional dynamic sections without baking every feature into the core application.

> **Security model:** plugins are trusted Admin-installed code. They run in the launcher process with application privileges, can create routes, run scheduled jobs, access the launcher database, and make server-side network requests. Do not install or update plugins from sources you do not trust. The Admin UI requires explicit acknowledgement of this trust boundary before install/update.

Core plugin-management API routes are listed in [api.md](api.md#plugin-management-api) and the machine-readable contract at `/api/openapi.json`. This guide covers the trusted plugin extension API and manifest contract.

## What plugins can do

A plugin can provide:

- backend API routes under `/api/plugins/:pluginId`,
- SQLite tables and migrations,
- scheduled jobs,
- static frontend files under `/plugins/:pluginId/*`,
- dashboard sections rendered on the portal page, and
- a configuration schema rendered by the Admin console.

## Installation model

The Admin console supports GitHub repository URLs and GitHub tree URLs for plugin subdirectories. The launcher discovers versions from GitHub releases and tags. Admins choose a specific version to install.

Current behavior:

- GitHub releases/tags are supported for normal installs.
- Plugin repositories may keep `plugin.json` at the repository root, or they may use a URL such as `https://github.com/OWNER/repo/tree/main/plugins/example` when the plugin lives in a subdirectory.
- If a subdirectory tree URL has no releases or tags, the launcher offers the explicit tree branch as a development fallback. Releases or tags are still recommended for production installs.
- Versions are manually selected and pinned.
- Installed tarball SHA-256 hashes are stored and shown in the Admin console. Admins may also provide an expected SHA-256 checksum during install/update; mismatches fail before extraction.
- GitHub plugin archives are extracted with path, entry-count, expanded-size, and symlink/hardlink safety checks.
- The Admin console reports lifecycle state: installed, enabled, disabled, failed, and update available.
- Updates are manual, show release notes when GitHub provides them, preserve existing plugin config, and roll back automatically if the updated plugin fails to load.
- After a successful install or update, superseded install directories and leftover download archives in the plugin directory are removed automatically (a rolled-back update keeps its previous directory).
- Local filesystem installs are supported for development when `NODE_ENV` is not `production` or `ENABLE_LOCAL_PLUGIN_INSTALL=true`.
- Plugins are enabled/disabled/reloaded from the Admin console.
- Plugins are not sandboxed.

## Plugin layout

A plugin repository should look like this:

```text
my-plugin/
├── plugin.json
├── server/
│   └── index.js
├── public/
│   └── plugin.js
└── README.md
```

## Manifest

Every plugin must include `plugin.json` at the root of the install target. For repository-root installs, that means the repository root. For GitHub tree URL installs, that means the selected subdirectory.

```json
{
  "id": "news",
  "name": "News Reader",
  "version": "0.2.0",
  "launcherApiVersion": "1",
  "backend": "server/index.js",
  "frontend": "public/plugin.js",
  "permissions": ["routes", "storage", "jobs", "dashboard-section"],
  "configSchema": {
    "sectionTitle": { "type": "string", "default": "Latest headlines", "scope": "editor" },
    "apiToken": { "type": "string", "scope": "admin" }
  }
}
```

### Manifest fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable unique plugin ID. Used in URLs and database records. |
| `name` | Yes | Human-friendly display name. |
| `version` | Yes | Plugin version. Should match release/tag when published. |
| `launcherApiVersion` | Yes | Launcher plugin API version expected by the plugin. Current value: `1`. |
| `backend` | Optional | CommonJS module exporting `register(context)`. |
| `frontend` | Optional | Browser script loaded when the plugin exposes dashboard sections. |
| `permissions` | Optional | Human-readable declared capabilities. |
| `configSchema` | Optional | Configuration fields rendered in the Admin console. Supported types: `string`, `number`, `boolean`, and `enum`. Each field may declare `scope`: `admin` (default), `editor`, or `user`. |
| `publicAccess` | Optional | Set to `true` to opt the plugin's API routes out of the launcher-enforced public-read gate (see below). Default `false`. |

### Public-read gate on plugin routes

The launcher wraps every router mounted with `mountRouter` in a read gate: `GET` and `HEAD` requests to `/api/plugins/:pluginId/*` require launcher read access — a signed-in user, or anonymous access when public read is enabled — exactly like core routes. Ungated requests are rejected with `401` before the plugin sees them.

A plugin that intentionally serves public data (for example, a status endpoint consumed by external dashboards) can set `"publicAccess": true` in its manifest to opt out. Mutating methods (`POST`/`PUT`/`PATCH`/`DELETE`) are not affected by the gate; they remain the plugin's responsibility via `context.requireRole(...)`, and launcher CSRF protection still applies.

## Configuration scopes

Plugin config is stored as one JSON object per plugin, but write access is field-scoped by the manifest:

- `scope: "admin"` or omitted: Admin-only. Use for credentials, endpoint URLs that affect trust, destructive behavior, and anything that changes server-side authority.
- `scope: "editor"`: Editor-safe operational settings. Editors may save these fields, and Admin-only fields already stored in the plugin config are preserved.
- `scope: "user"`: User-preference-safe fields. The current generic plugin config API allows Admins and Editors to save them; future per-user plugin preference APIs should use this scope for Basic User preferences.

Non-Admin requests cannot create arbitrary config keys outside `configSchema`. Admins may still write unknown keys for migration and emergency recovery, but published plugins should declare every configurable field and scope explicitly.

## Backend entrypoint

The backend module exports `register(context)`.

```js
exports.register = async function register(context) {
  context.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_example_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    )
  `);

  const router = context.createRouter();

  router.get('/items', (req, res) => {
    const items = context.db.prepare('SELECT * FROM plugin_example_items ORDER BY id DESC').all();
    res.json({ items });
  });

  context.mountRouter(router);

  context.registerDashboardSection({
    id: 'example',
    title: 'Example',
    script: context.publicScriptUrl
  });
};
```

Routes are mounted under:

```text
/api/plugins/:pluginId
```

For the example above, `GET /items` becomes:

```text
GET /api/plugins/example/items
```

## API response convention

Core and plugin APIs should keep responses predictable for frontend and plugin authors:

- Successful commands that do not need a resource body return `{ "ok": true }`, optionally with additional fields such as `count` or `updatedFields`.
- Resource reads and writes return a named resource envelope such as `{ "service": { ... } }`, `{ "plugins": [ ... ] }`, or `{ "config": { ... } }`.
- Errors return HTTP 4xx/5xx with `{ "error": "human-readable message" }`; routes may include extra machine-readable details beside `error` when useful, but should not replace that field before a stable v1 API is designed.
- Mutating requests after login must include the CSRF token returned by `/api/auth/login` or `/api/auth/session`.
- Authenticated and read-gated plugin API routes revalidate the session user against the database before using role-specific behavior.

Use the shared server helpers in `src/server/api-response.js` for new core routes so the current convention remains consistent.

## Backend context

The `context` object currently includes:

| Property | Description |
| --- | --- |
| `id` | Plugin ID. |
| `manifest` | Parsed plugin manifest. |
| `launcherApiVersion` | Current launcher plugin API version. |
| `db` | Shared `better-sqlite3` database connection. |
| `fetch` | Runtime `fetch` function. Plugins are trusted server-side code; this raw fetch is not restricted by `SERVER_FETCH_PRIVATE_NETWORK_ACCESS`. |
| `guardedFetch(url, options, guard)` | SSRF-guarded fetch with response-size limits, redirect pinning, and timeouts. Prefer this over `fetch` for URLs that come from config or users. Pass `{ actorRole }` in `guard` to apply the launcher's private-network policy (defaults to `admin`). |
| `canRead(req)` | Returns `true` when the request has a session user or anonymous public read is enabled. Use this to gate plugin GET routes the same way core routes are gated. |
| `requireRole(...roles)` | Express middleware factory: responds 401 without a session, 403 when the session role is not listed. |
| `XMLParser` | `fast-xml-parser` XML parser constructor. |
| `publicScriptUrl` | URL for the plugin frontend script, if present. |
| `createRouter()` | Returns an Express router. |
| `json()` | Express JSON body parser middleware. |
| `mountRouter(router)` | Mounts the router under `/api/plugins/:pluginId`. |
| `registerDashboardSection(section)` | Adds a dashboard section. |
| `getConfig()` | Reads the plugin config object. |
| `log(level, action, details)` | Writes plugin-scoped audit logs as `plugin.<id>.<action>`. |
| `setInterval(fn, ms, name)` | Registers a scheduled in-process job with management-plane status. |

## Frontend dashboard section

A plugin frontend script registers one or more dashboard sections:

```js
window.HomeLabLauncher.registerPluginSection({
  id: 'example',
  title: 'Example',
  render: async ({ container, api, user, preferences, setPluginPreference }) => {
    const data = await api('/api/plugins/example/items');
    container.innerHTML = data.items.map((item) => `<p>${escapeHtml(item.title)}</p>`).join('');
  }
});
```

The frontend `api` helper sends same-origin requests and throws on non-2xx responses.

Plugin render functions also receive the current signed-in user, the current plugin's per-user `preferences` object, and `setPluginPreference(key, value)`. Use plugin preferences for display-only choices such as theme, density, hidden panels, and local filters. Preferences are stored under `/api/me/preferences/plugins` for signed-in users and in browser local storage for anonymous public-read viewers.

Example per-user theme preference:

```js
window.HomeLabLauncher.registerPluginSection({
  id: 'status',
  title: 'Status',
  render: async ({ container, preferences = {}, setPluginPreference }) => {
    const theme = preferences.theme === 'pixel' ? 'pixel' : 'default';
    container.innerHTML = `<select id="theme"><option value="default">Default</option><option value="pixel">Pixel</option></select>`;
    container.querySelector('#theme').value = theme;
    container.querySelector('#theme').addEventListener('change', async (event) => {
      await setPluginPreference('theme', event.target.value);
    });
  }
});
```

## Frontend styling and responsive layout

Plugin sections are inserted as full-width dashboard panels. Each plugin should own its internal layout and remain usable at desktop, tablet, and phone widths.

Recommended conventions:

- Prefix plugin CSS selectors with the plugin ID or a stable shorthand, such as `.hll-weather-*`, to avoid leaking styles into the launcher or other plugins.
- Use launcher design tokens instead of hard-coded app chrome colors where possible: `--surface`, `--surface-2`, `--surface-3`, `--ink`, `--muted`, `--line`, `--line-strong`, `--primary`, `--primary-ink`, `--success`, `--warning`, `--danger`, `--focus`, `--radius-sm`, `--radius`, and `--radius-lg`.
- Treat plugin themes as plugin-local display preferences unless they affect server-side authority. Use `setPluginPreference()` for per-user themes and plugin config fields for admin/editor operational settings.
- Test at approximately `860px`, `720px`, and `520px` widths. Stack major columns by tablet width and avoid horizontal page overflow on phones.
- Prefer touch targets around 44px high for interactive controls and make action rows wrap or stack on narrow screens.
- Use horizontal scroll rails for dense forecast/timeline/card strips instead of shrinking content until it becomes unreadable.
- Respect `@media (prefers-reduced-motion: reduce)` for animations, skeletons, and decorative effects.
- Keep bundled assets under the plugin's `public/` directory and reference them through `/plugins/:pluginId/...`.

## Dashboard visibility

If no enabled plugin registers a dashboard section, the launcher hides plugin dashboard content completely for viewers. This keeps the anonymous/basic-user homepage clean.

Each registered plugin dashboard section becomes its own full-width layout item. Signed-in users can use the header layout editor to move plugin sections independently from the hero and service launchpad.

## Naming database tables

Plugins share the application SQLite database. Prefix plugin-owned tables to avoid collisions:

```text
plugin_<pluginId>_<tableName>
```

Example:

```text
plugin_news_feeds
plugin_news_items
```

## Local development

During development, start the launcher with `NODE_ENV=development` and install a plugin from a local path in **Admin → Plugins**. Local plugin reloads unmount and remount plugin routes/static assets so backend and frontend changes can be tested without rebuilding the launcher.

For Docker Compose development, set `ENABLE_LOCAL_PLUGIN_INSTALL=true`, set `LOCAL_PLUGIN_HOST_DIR` to the host directory containing plugin projects, and use the mounted container path in the UI. Example: host `./local-plugins` is mounted as `/app/local-plugins`, so install `/app/local-plugins/news`. Host paths under `LOCAL_PLUGIN_HOST_DIR` are auto-mapped when possible.

In production, local path installs are blocked unless `ENABLE_LOCAL_PLUGIN_INSTALL=true` is explicitly set. Do not enable local plugin installs for normal production users; it is a development escape hatch for trusted operators.

## Publishing a plugin

1. Commit the plugin repository.
2. Create a GitHub tag or release, for example `v0.1.0`.
3. In the launcher Admin console, open **Plugins**.
4. Enter the GitHub repository URL.
5. Discover versions.
6. Select the release/tag and install.

## Example: News Reader

The first plugin project is stored separately at:

```text
https://github.com/TMASoft/home-lab-launcher-plugins/tree/main/uptime-kuma
```

It demonstrates:

- plugin manifest metadata,
- SQLite plugin tables,
- RSS fetching/parsing,
- an API under `/api/plugins/news`,
- a dashboard section,
- a scheduled refresh job,
- feed/folder management UI,
- per-feed refresh status,
- item cleanup/retention, and
- OPML import/export.
