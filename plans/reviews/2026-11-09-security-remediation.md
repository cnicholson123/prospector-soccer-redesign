# Phase 6b — Security remediation (from Fable + Astra security reviews, 2026-11-09)

Details for the Astra items (A#) are in `plans/reviews/2026-11-09-security-astra.md`. Fable's probe scripts are in
`/private/tmp/claude-501/-Users-chris--t3-projects-prospectorweb/fea5a2fa-c674-4451-aba7-93ca40b5d707/scratchpad/probe/probe1.mts` and `probe2.mts` (run with `npx tsx` from the repo root; adapt if paths changed). Every fix needs a regression test that fails before the fix. Fixes must hold for BOTH the FS and Postgres stores (run the Postgres suites via Docker as in Phase 6).

## Must fix

- **A3 Concurrent publish can undo a completed publish.** Capture documents and the snapshot generation consistently; require the original generation at commit; increment document versions on every envelope change (publish/unpublish/schedule). Test: stale in-flight rebuild must not resurrect an unpublished doc.
- **A4 Unrelated publishes release pending deletions.** Preserve existing published membership until an explicit selected unpublish; manifest validation accordingly; audit every actual live change. Test: trash A, publish B → A still live until A is explicitly unpublished.
- **A5 Scheduled dependencies.** Reference protection must include frozen scheduled data, atomically. Settlement failures must be isolated: never block auth/logout/cancel/untrash/repair routes; surface as a health issue.
- **A6 Contributor media restore bypass.** Restore of media docs must enforce `media.edit` against the current owner (or be denied for the generic route).
- **A7 Session revocation + audit** in one transactional store operation (journaled on FS); bulk revocation atomic.
- **A8 Restore-and-publish** must be atomic, or return the committed draft plus a separate publish failure — never an error with silently changed content.
- **A9 / M4 Malformed tokens / bad input → 500.** Compare buffer lengths before `timingSafeEqual` (CSRF, cron); `?cursor=garbage` → 422; `onError` must handle non-object throws.
- **F-H1 Owner lockout DoS.** Lock per (username, IP) plus a slower username-wide throttle; a correct password from a non-offending IP is not blocked by other IPs' failures; add `npm run unlock -- <username>` (audited).
- **F-H2 Unauthenticated audit flooding.** Audit only the first failure and lock transitions per window; count repeats in the rate-limit record. `queryAudit` must not load a whole month into memory (paginate in the store).
- **F-H3 Creation revision destroyed by coalescing.** Coalesce only when the latest revision's action is `edited`; seal `created`/`duplicated` revisions on first subsequent edit. Test: create "A" → edit "B" → both revisions retained and restorable.
- **F-M1 Fail-open route auth.** `app.use('/api/admin/*', authenticate)` with explicit exemptions only for `auth/login`, `healthz`, `cron/*`; test that an unknown future route returns 401.
- **F-M2 Weak-owner-password health item** shown only to users with `users.manage` or to that Owner.
- **F-M3 Unbounded identifiers.** Cap key parts at ≤200 bytes; login username must match the creation regex; doc ids `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`; long values → 4xx, never 500 or `needsRecovery`.
- **Bootstrap password policy (Chris's decision pending).** Implement `ADMIN_FORCE_PASSWORD_CHANGE` (boolean env, default `true` in production, `false` in dev/test). When true and the bootstrap password is weak, set `mustChangePassword: true`; `authenticate` returns 403 `password_change_required` for everything except `/auth/me`, `/auth/password`, `/auth/logout` until changed. When false, keep the persistent weak-password banner/health item only. Document both in README-deploy.md.

## Should fix (cheap)

- **F-L1** `saveUser` (rename) through the mutation journal.
- **F-L2** `/auth/password` current-password attempts: per-user 10 / 15 min.
- **F-L3** Document XFF trust assumption (Vercel only) in README-deploy.md.
- **F-L4** Cookie name `__Host-psc_session` in production (Secure, Path=/, no Domain).
