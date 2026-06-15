# Screenshots

Add release screenshots or GIFs here before publishing a formal public release. Use the neutral demo data from `npm run dev:seed`; do not capture maintainer-specific hostnames, private service URLs, tokens, local paths, or personal plugin configuration.

Recommended beta captures/placeholders:

- `launchpad.png` — anonymous or signed-in launchpad with services and optional plugin sections.
- `service-edit.gif` — adding/editing a service, including Test URL.
- `appearance-customization.png` — Appearance tab with branding/theme controls.
- `admin-overview.png` — Admin Overview beta readiness checklist and warnings.
- `mobile-view.png` — mobile launchpad/admin tabs responsive pass.
- `plugin-trust.png` — plugin manager trusted-code acknowledgement.

Static Firefox `--screenshot` captures the app too early in this environment and only records loading skeletons. Use a wait-capable browser automation tool, such as Playwright or an equivalent CI artifact workflow, for final release assets.
