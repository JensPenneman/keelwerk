# 14. Accounts and authentication: opaque tokens apart from ids, one credential model, re-authentication for credential changes

Date: 2026-10-11

## Status

Proposed

## Context

The brief requires an authentication module in which users keep their login information and sign
in, and a separate accounts module that authentication influences and that influences
authentication. The first draft specified the pair only through sketches, and the review of
2026-10-11 found them unsafe: `auth.login` returned the session's entity id as the bearer
credential, although that id appears in events, receipts, logs and live streams and can be read by
anyone allowed to read sessions; `resetPassword` let a session set a new password without the
current one, so a stolen session became a permanent takeover; and how the session resolver reaches
tenant data before an action runs, how tokens are stored, how revocation ends live connections and
how passkeys, passwords and app passwords relate were open, although the listener, secret and
credential-scope gaps (G1, G4, G13) depend on them.

## Decision

1. **Two modules.** `accounts` (lower: profiles, registration, deactivation, the `identityProviders`
   extension point) and `auth` (higher: credentials, sessions, login), with `accounts` optional for
   `auth`; auth contributes login fields and credential actions to profiles and reacts to profile
   deactivation in a conditional part (architecture.md sections 5.4 and 17.2).
2. **Tokens are not ids.** Session tokens, API keys, app passwords and node credentials are issued
   once by the key service as `<prefix>_<public id>_<secret>` (128-bit public id, 256-bit secret).
   Rows store the public id and an HMAC verifier of the secret; tokens are stored nowhere and never
   appear in events, receipts or logs; session ids authenticate nothing.
3. **One credential model per purpose.** `auth.credential` holds what people log in with: passwords
   (an Argon2id hash through `node:crypto`, with at least OWASP's minimum parameters, rehashed on
   login when they rise) and passkeys (`@simplewebauthn/server` 14.0.3, challenges in rows rather
   than process memory). API keys and app passwords, which authenticate programs and protocol
   clients, are `api-keys.key` rows with scopes and allowed transports. All share the token format
   and the verifier storage.
4. **Expiry and rotation.** Sessions expire after an idle period (12 hours by default) and an
   absolute lifetime (30 days); activity extends them at most every five minutes. Every login
   creates a new session; a password change revokes every other session and rotates the current
   one; a privilege elevation rotates a cookie session.
5. **The resolver's read path.** The session resolver is a principal resolver bound to `auth`'s
   context. After scope resolution it reads the token from the `__Host-` cookie or the bearer
   header, looks the session up by public id in a read-only unit of the resolved tenant, compares
   verifiers in constant time, checks revocation and expiry, and caches the result for at most 30
   seconds, dropping it when the change feed reports a change of that session. Revocation events
   (the session's, its credential's, the profile's deactivation, membership changes) revalidate live
   connections at once. Unknown, expired or revoked cookie sessions count as absent; invalid bearer
   tokens fail.
6. **Re-authentication.** Changing a credential (password, passkeys, app passwords, the login
   identifier) needs the current password or a full authentication within the last ten minutes,
   else `auth.reauthentication_required`. Nobody sets another person's password: resets go through
   a one-time token delivered by the `auth.resetDelivery` extension point, and consuming it revokes
   every session of the subject.
7. **Abuse limits.** Token buckets per remote address and per identifier at `admit`, shared across
   processes through the quota model, on login, passkey ceremonies, re-authentication and resets;
   unknown identifiers take the same time as known ones.
8. **Login flows.** Browsers receive the token as a `__Host-` cookie set by the `http.cookie` hint
   (bearer tokens under path-based tenant resolution); the CLI's `pennestack login` uses actions
   with a `cli.login` hint and stores the token in a mode-0600 file, with a device authorization
   flow for passkey-only accounts.
9. **Realms per tenant.** Credentials and sessions are tenant rows; one login across tenants or
   backends is a later OpenID Connect module, not shared tables.

## Consequences

- A leaked session id, log line or event never grants access; a database dump yields no usable
  token and, with the sealing of ADR 0009, no former password hash.
- A stolen session cannot lock the owner out by changing the password, and revocation reaches open
  connections within the wake-up latency.
- Passkeys and passwords coexist on one entity; protocol clients get scoped app passwords instead of
  account passwords.
- Every request with a session costs a lookup in the tenant's namespace, softened by a short cache
  that revocation invalidates.
- Long-lived credentials that must work without a tenant host name (API keys, node credentials)
  depend on the scope directory of gap G2, whose ADR lands before M4 (Launchway's rebuild; M3 before
  the roadmap's reorder of 2026-10-28).
