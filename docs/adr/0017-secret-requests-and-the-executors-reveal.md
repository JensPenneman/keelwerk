# 17. The `ctx.secrets` requests and the executors' reveal

Date: 2026-11-19

## Status

Proposed (2026-11-19). WP-93 (effect jobs and executors), WP-105 (external performers) and WP-140
(a settle tied to its performer) are built to it. Architecture.md sections 6.6, 7.9.3, 7.9.5,
14.7.4 and 17.7 (gap G4) specify the design.

## Context

Module code must read secrets on purpose: Launchway builds deploy payloads with environment values
and calls GitHub with the App's private key and DNS providers with stored tokens; the mail server
signs with DKIM private keys, authenticates to the relay and serves certificates. Gap G4 specified
the key service and the sealing of credential material (sections 6.6 and 14.7.4) and proposed the
`ctx.secrets` interface, whose ADR the roadmap scheduled before M3.

M1 built the stored forms (register entries 367, 368 and 370): a sealed value's reference is
`kwv1.<key id>.<nonce>.<ciphertext>`, a row loaded by a part carries `{ ref }` for a secret, and a
configuration secret is `kwc1.<backend>.<module>.<field>.<keyVersion>.<nonce>.<ct>`. M1 refused
effect inputs with personal or secret fields and left effect outputs that carry secrets without a
sealing rule (open point 456). M2's executors reveal secrets, and roadmap section 1 requires an ADR
before the milestone that first depends on it, so the M2 plan (S-150) made this ADR due before
WP-93; WP-93 was built to what its sheet (D10) says this ADR must state. The second review of WP-72
showed that a sealed secret could otherwise be moved into another effect and revealed to an
attacker's destination; the lead's binding for WP-93 and WP-105 (2026-11-11) closes that.

## Decision

1. **Requests in handlers.** `ctx.secrets` in a handler offers three requests, answered by the key
   service (section 14.7.4). `reveal(value, reason)` is the only read path for a `field.secret()`
   value, for the owning module's handlers (with its bound services and extension values), logged
   with the reason and never recorded. `issue({ prefix, bytes? })` makes a one-time secret: the
   plain token goes to the caller once, and the decision record keeps only the public id and the
   verifier, the verifier in its sealed `kwv1` form under the row's value key. `verify(presented,
   verifier)` compares a presented token with a stored verifier in constant time. `issue` is a
   request of `decide`; `reveal` and `verify` are requests of `decide`, `read`, `react` and
   services, and neither is recorded (section 7.9.3).
2. **Sealing at append.** Sealing is no call: a draft that sets a `field.secret()` field carries the
   plain value, and the kernel seals it at append with a fresh value key bound to (entity, id,
   field), destroying the previous value's key. Verifier-only secrets (API keys, app passwords, join
   tokens, node credentials, session tokens) never use `reveal`; reversible secrets (provider
   credentials, DKIM and TLS private keys, the GitHub App key, environment values) do, always from
   the module that owns the field, and other modules reach them through that module's services.
   Secrets in module configuration are sealed under the backend's key, or the tenant's for tenant
   overrides (M1 seals under the backend key only), and a reveal refuses a `kwc1` text of another
   backend or module.
3. **The executors' reveal.** `ctx.secrets` in an effect executor (`ExecutorSecrets`) has one
   member, `reveal(ref, reason): Promise<string>`; `issue` and `verify` are not available to
   executors. It accepts a `{ ref }` stamped for the effect's module whose text is that of a secret
   member of the effect's stored input or of the module's own configuration; a `kwc1` configuration
   secret opens only for its own module and the backend of the job. Anything else is refused
   (`internal`, `core.request_not_allowed`). The reason is required; the reveal is logged with it,
   the effect id and, for a sealed value, its key id, and nothing is recorded. The value opens
   through the key service in a short read-only unit of the effect's scope.
4. **Secrets in effect inputs and outputs.** An effect's input and output carry secrets only as
   references the effect's module loaded or as fresh plain values; a foreign or client-sent
   reference is refused with `validation`. A secret the module hands to an effect as a plain value
   or as a `kwv1` reference it loaded is sealed for that effect under its own value key, bound to
   `core.effect`, the effect id and the member path, and a sealed value opens only against that
   binding, outputs included. Replacing the secret therefore does not reach effects already
   requested. The value keys are destroyed when the effect settles (WP-126). The module's own
   `kwc1` configuration secret is the exception: it stays its `kwc1` text and opens by that text,
   only for its module and the backend of the job (item 3).
5. **Continuations.** A continuation reads the secrets of an effect's output as references of the
   effect's module.
6. **External performers.** An external performer (WP-105) receives pending inputs through the same
   stamp check and never the plaintext of a reference it did not load. The plain members of
   `PendingEffect.input` are decoded domain values. The `where` of `ctx.live.effects`, which a
   settle also takes (WP-140), is over the plain input: a `where` over a sealed member is refused at
   compose or at the settle (`internal`), and an effect whose stored input is not whole in the clear
   (a member that no longer decodes, or a plain member that holds a sealed value) matches no
   `where`; it ends by its deadline or by a settle without a `where`.

## Consequences

- A secret reaches an executor or a performer only through a reference stamped for the effect's
  module: a client cannot name a stored secret in an effect's input, and a sealed value moved into
  another effect or another member does not open there.
- A failed settle never stores the executor's error text in plaintext, because an SMTP or HTTP error
  can repeat a personal value the input sealed.
- Every sealing has a fresh key id and nonce, so a second settle of the same effect is recognised by
  the effect's status, never by comparing output digests.
- An executor's output is sealed before it is measured; until blob references arrive with M4
  (S-130), an output over 64 KiB of sealed canonical JSON settles the effect `failed` with
  `core.effect_output_too_large` (kind `unsupported`).
