# Pre-deploy remediation (Fable + Astra reviews of phases 10–12, 2026-11-09)

Astra's full report: plans/reviews/2026-11-09-predeploy-astra.md. Fable findings are summarized below (F#). Each fix needs a regression test that fails before the fix, on FS and (where storage is involved) Postgres via Docker PostgreSQL 17.

## Must fix
- **A1 Scheduled media delivery** (server/media.ts ~130): delivery authorization and media lookup must use the same time-effective snapshot (due schedules applied) as public rendering, so a scheduled replacement is served at its deadline without cron/admin traffic; old URL behavior consistent. Test before/after deadline without settlement.
- **F1 Temporary passwords**: accounts created by an admin or reset by an admin get `mustChangePassword: true`; enforce server-side in createAuthenticate (server/http/middleware/auth.ts) — reject non-`/api/admin/auth/*` requests with 403 `password_change_required` while set; UI routes to Profile change-password; copy no longer says changing is optional for temp passwords. Bootstrap accounts (ADMIN_BOOTSTRAP_USERS, e.g. Phil/Chris) keep `mustChangePassword: false` and ADMIN_FORCE_PASSWORD_CHANGE semantics are unchanged (Chris chose optional changes for those accounts). Update tests that encoded the old behavior.
- **F8** POST /api/admin/users must not accept a caller-chosen password; always generate the one-time temporary password.
- **F2 Self-edit**: an Admin (or any role with users.manage) can edit their own displayName/email (and username if allowed) — skip the role-ceiling check when old.id === actorId while keeping "cannot change own role"; non-managers get a self-service profile endpoint under /api/admin/auth/ for displayName/email.
- **F6** Block self-deactivation (any role); hide the self Deactivate control.
- **A5 Palette safety**: the palette's default/first item must not publish; "Publish all" opens the Review & publish tray pre-populated (human confirms there); default selection is navigation.
- **F4 Bootstrap**: do not recreate users by username on every cold start — run ADMIN_BOOTSTRAP_USERS only when the user table is empty (or track bootstrap identity by a stable key so renames are respected); document that the env var only seeds a fresh install.
- **F3 CRON_SECRET** required in production (config load fails without it); README-deploy marks it Required.
- **F5 Media caching**: unpublished/trashed media must stop being served publicly within the content cache window — use `public, max-age=0, s-maxage=86400` (or tag media responses and purge on publish/unpublish/trash). Document residual browser-cache behavior.
- **A4 Finalization leaks**: validate metadata (alt length etc.) before copying binaries; on any failure after copy, delete the copied verified object (or journal + cleanup). Add a per-user daily byte quota for uploads (configurable, sensible default).
- **F7** Images must include the client-generated web variant (≤2000px) — reject image finalization without webTicket (or cap originals used as web to 2000px).
- **A7/F9** users.update audit records before/after for username, displayName, email, role, active (never passwords/hashes).
- **F10** Media delivery: Content-Disposition `inline; filename="<sanitized original filename>"` for PDFs.
- **A6** No-JS header navigation at 1141–1200px: apply the collapsed (menu-button) header only when JS is available (`.js` class) or provide a native fallback; desktop nav must remain usable without JS at those widths. Public goldens may need an intentional update — explain.

## Deferred (document in README "Known issues/limitations")
- A3 full server-side bounded image decoding (headers + dimensions are verified; client produces WebP).
- A2 strict zero-write on cold/aged requests (bounded maintenance writes ≤1/15 min session refresh, ≤1/10 min GC claim).
- F11 draft media lookup scan (perf only).
