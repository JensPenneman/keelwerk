# @keelwerk/module-auth

Credentials and sessions: sign-up, login, logout, revocation and the session resolver. It builds on `@keelwerk/module-accounts` (optional at run time) and works without it.

- `auth.credential` (chain, data subject `subject`): a password credential per person, `identifier` (the e-mail address, personal, unique among active password credentials), `verifier` (an Argon2id PHC hash, hidden and sealed in events), `lastUsedAt`, `revokedAt`; domain events `revoked` and `signedUp`.
- `auth.session` (state, data subject `subject`): `publicId`, `tokenVerifier`, the authentication and expiry instants, client metadata (`userAgent`, `address`, personal and sealed).
- `auth.signUp`: public and rate-limited; creates a password credential under a fresh opaque subject. A taken identifier is `auth.identifier_taken`.
- `auth.login`: public and rate-limited; verifies against a dummy hash for an unknown identifier, rehashes with the current parameters when needed, issues `pss_<public id>_<secret>` once (`shownOnce`, never in the receipt). The `http.cookie` hint sets `__Host-keelwerk_session` for browser requests; the `cli.login` hint names `sessionToken`.
- `auth.logout`, `auth.session.revoke`, `auth.credential.revoke`, `auth.revokeSubject` (invoked by auth's own reactions), `auth.whoami`.
- The session resolver (a principal resolver of the core): cookie or bearer token; a stale cookie is anonymous and clears the cookie, a stale bearer token is `unauthenticated`. When a session was last extended more than five minutes ago it enqueues `auth.extendSession`, keyed by session. M1 runs no worker, so sessions do not slide until M2.
- The rate-limit rule (`invocationMiddleware`): `addressAttemptsPerMinute` (10) per remote address charged at admission, `identifierFailedAttempts` (5) per `identifierFailureWindowMinutes` (15) per identifier charged on a declared failure. A request without a remote address (in-process, CLI socket) has no address bucket.

Configuration: `sessionIdleMinutes` (720), `sessionAbsoluteDays` (30), `reauthenticateWithinMinutes` (10) and the three limits above.

Not here yet: the profile link of sign-up and the conditional parts for accounts (WP-62), re-authentication, password reset and passkeys.

`src/module.generated.ts` is produced by `pnpm manifests` and the files under `migrations/own/` by the CLI migrations producer; neither is edited by hand.
