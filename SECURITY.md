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

- Plugins are trusted code and are not sandboxed.
- Service health checks, URL tests, and remote image downloads are server-side fetches. Restrict private-network fetches with `SERVER_FETCH_PRIVATE_NETWORK_ACCESS` when Editors are not trusted to probe internal URLs.
- The app should be served over HTTPS whenever credentials cross an untrusted network.
- `.env`, SQLite databases, private certificates, and plugin runtime data must not be committed.
