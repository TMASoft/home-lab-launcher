# Security Policy

## Supported versions

Home Lab Launcher is pre-1.0. Security fixes are expected to land on the latest `main` branch and tagged releases going forward.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Instead, use GitHub private vulnerability reporting if enabled for the repository, or contact the repository owner directly.

Include:

- affected version or commit,
- deployment mode,
- reproduction steps,
- expected and observed impact, and
- any relevant logs with secrets redacted.

## Security assumptions

- Plugins are trusted code and are not sandboxed. The plugin catalog is curation metadata only: it improves discovery and review (declared permissions, compatibility, optional SHA-256 hashes) but does not sandbox plugins or replace the explicit trust acknowledgement, and installs are always pinned to an admin-selected version. Catalog fetch failures never affect installed plugins.
- Service health checks, URL tests, and remote image downloads are server-side fetches. Restrict private-network fetches with `SERVER_FETCH_PRIVATE_NETWORK_ACCESS` when Editors are not trusted to probe internal URLs.
- Service discovery never mounts or assumes the Docker socket; it only talks to an Admin-configured endpoint, and a read-only socket proxy is the recommended deployment (see `docs/deployment.md`). Pasted Compose YAML is treated as untrusted input; environment values and secret-like labels are never read.
- The app should be served over HTTPS whenever credentials cross an untrusted network.
- `.env`, SQLite databases, private certificates, and plugin runtime data must not be committed.
