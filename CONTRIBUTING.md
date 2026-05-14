# Contributing

Thanks for helping improve Home Lab Launcher.

## Development setup

```bash
npm install
npm run check
npm test
npm run dev
```

The app requires Node.js 20+ for the supported runtime. Docker Compose is the preferred deployment target.

## Pull request expectations

- Keep secrets out of commits. Use `.env` locally and `.env.example` for scaffolded configuration.
- Update documentation when behavior changes.
- Add or update tests for API, role, and UI behavior where practical.
- Run `npm run check`, `npm test`, and a Docker build before opening a release PR.

## Plugin changes

Plugin APIs are still pre-1.0. If a change affects plugin compatibility, update `docs/plugins.md`, `CHANGELOG.md`, and release notes.
