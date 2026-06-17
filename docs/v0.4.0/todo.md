# v0.4.0 Todo

This list captures the remaining security, functionality, and API-contract work identified during the v0.4.0 planning review.

## Security And Auth

- [x] Revalidate session users against the database in shared auth/read middleware before honoring `req.session.user`.
- [x] Reject sessions for deleted users instead of trusting cached session identity.
- [x] Refresh cached session username/role when the backing user record changes.
- [x] Ensure `requireRole` denies users immediately after demotion.
- [x] Revoke other sessions after a user changes their own password.
- [x] Revoke target-user sessions after an Admin changes that user's password.
- [x] Revoke target-user sessions after an Admin resets that user's TOTP state.
- [x] Revoke target-user sessions after role downgrade or account deletion.
- [x] Keep the current session only when the current user remains valid after a self-update.
- [x] Prevent deleting, demoting, or otherwise removing the last Admin account.
- [x] Block self-demotion unless another Admin account exists.
- [x] Consider requiring password reauthentication for self role-sensitive account changes. Deferred until a broader reauth flow is designed.
- [x] Replace direct CSRF string comparison with `crypto.timingSafeEqual` using equal-length buffers.

## Input Validation And Service Behavior

- [x] Route preset service imports through the same URL validation used by normal service creation.
- [x] Reject invalid preset `customUrl` values such as `javascript:`, `ftp:`, malformed URLs, and empty non-fallback values before downloading/caching preset icons.
- [x] Confirm preset imports still accept valid `http://` and `https://` URLs and preserve expected preset metadata.
- [x] Recheck service import/export behavior for parity with `servicePayload` validation.

## Tests

- [x] Add regression coverage proving stale Admin/Editor sessions lose privileges after demotion.
- [x] Add regression coverage proving deleted users cannot keep using existing sessions.
- [x] Add regression coverage for session revocation after self password change.
- [x] Add regression coverage for session revocation after Admin password reset and TOTP reset.
- [x] Add regression coverage for last-admin deletion and demotion protections.
- [x] Add regression coverage for preset import URL validation failures and successes.
- [x] Add regression coverage for timing-safe CSRF behavior without changing the public error shape.
- [x] Run `npm run validate` after implementation.

## API Contract And Documentation

- [x] Keep `docs/openapi.json` synchronized with every endpoint behavior change made for v0.4.0.
- [x] Update `docs/api.md` when request bodies, response envelopes, auth rules, CSRF rules, or status codes change.
- [x] Add examples for common operator API flows: login with CSRF, create service, update settings, export backup, and revoke sessions.
- [x] Consider adding automated OpenAPI validation to `npm run validate` or `npm run release:check`.
- [x] Decide whether to serve the OpenAPI document from a static or API route in the running app.

## Release Docs

- [x] Update `README.md` security notes for session revalidation and revocation behavior after fixes land.
- [x] Update `docs/deployment.md` if any security-default or operational behavior changes.
- [x] Update `docs/release-checklist.md` with any new v0.4.0 security/API contract gates.
- [x] Update `docs/plugins.md` if plugin-visible API or config behavior changes.
- [x] Add `CHANGELOG.md` entries for each implemented security, validation, API, and documentation change.

## Review Before Release

- [x] Re-run a focused review of auth/session lifecycle after implementation.
- [x] Re-run a focused review of preset/service import validation after implementation.
- [x] Compare implemented routes against `docs/openapi.json` before tagging v0.4.0.
- [x] Verify Docker Compose config if deployment behavior changes. No Docker Compose behavior changed.
