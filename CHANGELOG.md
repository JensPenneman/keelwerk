# Changelog

## [0.3.0](https://github.com/JensPenneman/keelwerk/compare/v0.2.0...v0.3.0) (2026-11-21)


### ⚠ BREAKING CHANGES

* **transport-trpc:** for a backend whose trpc maxBodyBytes is below the host's maxBodyBytes, the tRPC mount answered a request body over its setting with status 400 and BAD_REQUEST. It now answers 413 and PAYLOAD_TOO_LARGE, with core.payload_too_large in data.keelwerk as before; every refusal with that code is mapped so. A client that tests for status 400 on that refusal must test for 413. At or above the host's bound the host already answered 413. SocketSession, which a host hands to a transport's WebSocketHandler, has two new required members, invocation() and maxMessageBytes: a host other than @keelwerk/transport-http, and a test fake of SocketSession, must implement both, since the tRPC transport takes a call slot for every query over its socket and bounds what a socket holds before tRPC reads it by the host's message bound. The tRPC mount now registers its upgrade at start, with websocket on or off, so it needs an @keelwerk/transport-http of the same release, whose upgrade table serves keelwerk.trpc.v1. TransportBounds of @keelwerk/testing has two new required fields, heartbeatMs and revalidateMs: a transport runtime or target built by hand must set them.
* **core:** UsageStore gains the required member charge(charges). A data adapter must now: charge core.eventBytes for every event and stream record a unit appends in a tenant or backend scope (storedEventBytes and storedStreamRecordBytes of @keelwerk/core measure them); sum the charges per dimension and refuse the unit with core.quota_exceeded when a dimension's net charge is above zero and leaves its counter above the smallest limit declared for it; honour StoredJobSpec.queuedCap at the commit tail: a unit that makes a capped job available and leaves more available jobs in the scope's queue than the cap is refused with core.queue_full and retryAfter 1 and rolled back; never store queuedCap on a job; take charges back with a failed savepoint; refuse UsageStore.charge in a namespace unit with an internal error; leave JobStore.readied() empty after a refused commit. A custom adapter must implement all of it. Operators: every runtime now enforces default limits (core.rows 10,000,000, core.eventBytes 10 GiB, and 10,000 queued jobs in the commands queue of a scope), so commands and enqueues past them are refused. Raise the limits in configuration or with core.quota.set.
* **adapter-postgres:** in @keelwerk/testing/postgres, guardClientConnections and the stop() of startPostgres fail when a listing started two seconds after they began still shows a connection; they waited ten seconds before. A test file whose connections go later than that now fails; end every pool and client in afterAll. startTestRuntime of @keelwerk/testing with an external PostgreSQL turns idle removal off for its control and placement pools, so a runtime that a test never stops keeps its connections open. keepIdleClients and waitForEmptyListing are new.
* **core:** JobStore has a new required member, release. A data adapter that implements JobStore itself must add it: give each running attempt of the worker back to available, conditional on the worker and the attempt, without counting the attempt and without changing its lost-lease count, return the lane and group slots, keep it the head of its FIFO key, record the job's queue as readied (readied answers undefined for a job in a group), and answer the attempts it gave back. ReceiptStore.claim must answer exists for an accepted receipt whatever its expiry. JobStore.take must not make an action job whose run carries a command id a dead letter for lost leases, at any count: from its third lost lease it keeps the job takeable and hands it out with the new StoredJob.leasesExhausted set. Adapters must change their reclaim accordingly.
* **core:** for test code on memory and PGlite, probe.wake() and the drains no longer sweep queues that came to rest at the clock's reading, so a job that no wake-up named, such as one freed by provisioning a namespace's job groups, runs only once the test moves the clock. A store double that holds a take back must answer it with no jobs and skippedLanes above 0, not with skippedLanes 0, or the test must move the clock; such a test keeps real timers, since the fetcher retakes after a pause on setTimeout.
* **core:** a principal resolver whose resolve or fromRef answers an expiresAt at or before now (for example one that accepts a credential within a leeway past its expiry and reports the raw expiry), and an invoker's operatorTokens that answers such an operator, now have their callers refused with core.unauthenticated (core.ticket_invalid through a ticket) on requests, streams, revalidations and jobs; such a job is not retried. They were served before. Such a resolver must report the expiry it enforces, or none. The resolvers of keelwerk already refuse such credentials, so their callers see no change.
* **core:** SubjectKeyStore gains liveValueKeys and sealValue takes an optional keyId. Whoever writes a data adapter must implement both, or the kernel cannot seal or erase a request record. Decision records gain a request member: an EventStore outside this repository must store it and decode request.nonce and request.ciphertext from base64url text to bytes, unless the request is a $kwe envelope; a store that holds such an event cannot go back to 0.2.0, whose chain content leaves the member out. spendCredential answers core.internal for a redemption whose entity keeps its history in the chain, which is the default: a resolver's credential entity must declare history: 'state'.
* **core:** decision records gain a prepare member. An EventStore outside this repository must decode prepare.reads[].at from decimal text to a bigint. 0.2.0 decodes such a record and keeps the prepare member as stored, but its chain content leaves the member out (encodeDecisionRecord in chain-content.ts), so its verifyChain reports a hash mismatch at the first event that carries one; a store that holds such an event cannot go back to 0.2.0.
* **core:** ChangeFeedSource has a new required method jobs(namespaces, signal), yielding JobWake { namespace, queues? }, and JobStore a new required method readied(), answering after the commit the queues the unit made takeable, undefined when it cannot name them, [] when none. The kernel's workers read jobs() instead of wake(). An adapter outside this repository fails to compile until its JobStore answers readied() and its feed's jobs() yields a wake-up after each commit that made a job takeable, without queues in the first wake-up of each namespace and in any that cannot name them; a jobs() that yields nothing leaves the workers to their one-second poll, and so does a feed without jobs() in untyped code, after the workers log that their change feed failed. describeAdapterConformance checks both members.
* **transport-http:** a mounted handler no longer receives TRACE. The host refuses every TRACE request itself, with 405 core.unsupported where no earlier refusal applies.
* **module-audit:** @keelwerk/core: the event of an on: 'all' reaction (ReactionEventOf<..., 'all', ...>, the parameter of react) is ObservedEvent, with the required members action, request and subject; code that builds such an event for react, for example from asyncReactionEventOf, adds them.
* **core:** ControlLeaseStore gains the required members total and expire; code that implements ControlLeaseStore must add them.
* **core:** a caller without a principal reference who repeats a finished command of an action that declares a credential member now gets core.idempotency_mismatch instead of the recorded outcome. A caller who lost the answer sends the command again with a new command id; the typed client returns this error rather than retrying it. A job under a chosen command id that meets such a receipt written directly by a caller ends failed with the same code. No stored format changes.
* **core:** composition refuses a declared quota whose default does not parse for its kind (quotaDefaultInvalid): a count that is not a whole number at or above zero, a byte size that is neither such a number nor <decimal><B|KiB|MiB|GiB|TiB>, or a rate that is not <count>/<duration> with a count of at least 1 and a period of at least one whole millisecond. An application author whose app is refused must correct that default.
* **adapter-postgres:** @keelwerk/testing: startPostgres().stop() rejects when a client connection is still open 10 s after the stop was asked for. Stop runtimes and end pools before the container is stopped.
* **core:** before a session opens, the HTTP host reads a path that starts with /t/<segment> as tenant-prefixed, also in a deployment without byPath: a failure under a REST mount there names /t/<segment> in its problem type, a path below /t/<segment>/_keelwerk answers the wire envelope and refuses a ticket in its query, and the security headers follow the path below the prefix. An application that serves its own routes below /t/ must move them elsewhere to keep their earlier failure responses.
* **transport-http:** the HTTP host refuses more answers on mounted routes. 0.2.0 refused only a text/event-stream body to a request that did not ask for one; now a content-type whose media type (case-insensitive, parameters ignored) is text/event-stream, multipart/mixed, multipart/x-mixed-replace, application/jsonl, application/x-ndjson or application/json-seq, or a transfer-encoding header naming chunked, is refused the same way when the route did not count the request: the host cancels the body and answers 500 core.internal. The shape decides, not the length, so a short body of these types is refused too. A custom transport whose route answers such a body declares `streams` on its RouteSpec or answers another content-type. A route that relays a fetch() response, which carries transfer-encoding: chunked whenever the upstream sent it chunked, answers a new Response whose headers leave out transfer-encoding, or declares `streams` when it relays a stream. A request a route counts as a stream, by its predicate or by the default, is no longer compressed. Routes whose answers carry none of these markers, server-sent-events routes whose requests ask for text/event-stream, and the routes of transport-rest and transport-graphql change nothing else. Coming from 0.1.0, which had no stream gate on mounted routes, the 0.2.0 note on event streams applies as well.
* **events:** a custom event store or job store must provide purgeTransient(before, limit, streamTypes) and purgeHistory(before, limit), which answer the rows removed and whether a candidate is left; purgeTransient refuses a type outside transientPurgeTypes.

### Features

* **core:** add control leases and broadcast notifications ([da6eec9](https://github.com/JensPenneman/keelwerk/commit/da6eec9bb36a5cc0ee5abb5ea24de0937743aa15))
* **core:** add the quota model and core.quota.set ([182fa35](https://github.com/JensPenneman/keelwerk/commit/182fa3532ae6421bc20c22b5b1483b7c41a14f1f))
* **core:** enforce usage quotas in the commit tail ([8463f3a](https://github.com/JensPenneman/keelwerk/commit/8463f3a573cbc8cb57e3a629f62dc9b22af7d0a8))
* **core:** rebuild state rows from the chain and replay decisions ([57d3dc7](https://github.com/JensPenneman/keelwerk/commit/57d3dc7f9d0e84a4ed75ce9fd69d79cff7d7dc5a))
* **core:** release unfinished attempts when a worker drains ([503a528](https://github.com/JensPenneman/keelwerk/commit/503a5280048a6d9a58988082115d0e61e907145e))
* **core:** resolve the tenant from a /t/&lt;tenant TypeID&gt; path prefix ([2daa4b0](https://github.com/JensPenneman/keelwerk/commit/2daa4b08a4d14a7a61692b32df2f5588ff6d733d))
* **core:** run effects inline while a request is prepared ([e8dda32](https://github.com/JensPenneman/keelwerk/commit/e8dda32e6398758aa4123adf775ea6ea9dbf40c4))
* **events:** purge operational buffers with a retention worker ([99a88ee](https://github.com/JensPenneman/keelwerk/commit/99a88eeda5aac3a28a5ef2271471bc32190e01df))
* **module-audit:** record every tenant event in an audit trail ([defc5b3](https://github.com/JensPenneman/keelwerk/commit/defc5b3daabf85e36f981f3265d0d4c2c8ff7ccb))
* **transport-http:** let a route declare which requests stream ([fbb94f0](https://github.com/JensPenneman/keelwerk/commit/fbb94f0fbc445a561aa17e4a4768e661c39f632d))
* **transport-orpc:** bound the request body per backend ([2c73758](https://github.com/JensPenneman/keelwerk/commit/2c7375824cbfca6e0ca930fde7bc4280df596c70))
* **transport-orpc:** serve the action tree over oRPC and OpenAPI ([0c44236](https://github.com/JensPenneman/keelwerk/commit/0c442368a04d6c37cae996147246731b1ea5b5a0))
* **transport-trpc:** add a websocket transport for tRPC ([ec362d8](https://github.com/JensPenneman/keelwerk/commit/ec362d833a8fb3e7eee5656f1dae8baf0b3bad1e))
* **transport-trpc:** serve the action tree over tRPC with superjson ([06c9cae](https://github.com/JensPenneman/keelwerk/commit/06c9cae62419370ff5b8116b042bab8c77635cdf))


### Bug Fixes

* **adapter-postgres:** begin a unit again after a lost idle connection ([01f9952](https://github.com/JensPenneman/keelwerk/commit/01f995268ea6ced3aeff50659b4dc7dc6111d9d3))
* **adapter-postgres:** end the pool on close when no unit ran ([bc45ab3](https://github.com/JensPenneman/keelwerk/commit/bc45ab30858ce426584f68b3424f1a78f9350e16))
* **adapter-postgres:** survive a connection the server ends ([94abb1f](https://github.com/JensPenneman/keelwerk/commit/94abb1fa3090bf4eade3720934bdfd0d2db05c4a))
* **core:** refuse a repeated credential command without identity ([254b12d](https://github.com/JensPenneman/keelwerk/commit/254b12d19317ae2eafaa37d43ac654303872e145))
* **core:** refuse to open a session for an expired principal ([50f4cd5](https://github.com/JensPenneman/keelwerk/commit/50f4cd52d5b9e89b81d2a3e424d37697bd1842d4))
* **core:** sweep only the queues a test drain can find work in ([8b0f033](https://github.com/JensPenneman/keelwerk/commit/8b0f033e9c85b327d41e2b5b8748895ac883d02c))
* **core:** wake only the queues a commit made takeable ([ca7f669](https://github.com/JensPenneman/keelwerk/commit/ca7f6698aefe82348b2aa849274b0c4c0557a5c8))
* **data:** let takes and settles lock a lane beside an open enqueue ([b08ac62](https://github.com/JensPenneman/keelwerk/commit/b08ac626b419d6f9930745389c8997da81f1df8c))
* **data:** serialise the end of a FIFO key head with appends ([49489c1](https://github.com/JensPenneman/keelwerk/commit/49489c1f4a6647c1f27acaca128e759f0f7840b0))
* **testing:** read an SSE block with data and no event line as a message ([06c9cae](https://github.com/JensPenneman/keelwerk/commit/06c9cae62419370ff5b8116b042bab8c77635cdf))
* **transport-http:** hand a mounted handler a readable empty body ([90115b5](https://github.com/JensPenneman/keelwerk/commit/90115b57c675ebce64d46da3aaccc5114c746870))


### Documentation

* apply the follow-ups of the M2 work packages to the specification ([a37105f](https://github.com/JensPenneman/keelwerk/commit/a37105fd6985df088fb8b554f2fb169e38ab0b50))

## [0.2.0](https://github.com/JensPenneman/keelwerk/compare/v0.1.0...v0.2.0) (2026-11-19)


### Security

In these notes a command receipt is a row of the table `core__command_receipt`, event meta is the `meta` column of `kw_events`, a job row is a row of `kw_jobs` and a dead letter is a job row in state `dead`; secret, verifier and personal members are the members declared with `field.secret()`, `field.verifier()` and `.personal()`, and an erasure is the removal of a data subject's personal data (`core.eraseSubject`).

0.1.0 stored the plain SHA-256 of the input of every command whose input carried no sealed value, every module-auth command among them, in the command receipt and in the meta of every event the command wrote; a command whose input did carry one (a backend or tenant create, or an entity command that names a secret or verifier field of its entity) got an HMAC-SHA-256 under a key of its scope instead. The input of `auth.login` and `auth.signUp` holds the e-mail address and the password, that of `auth.reauthenticate` the password, that of `accounts.profile.changePassword` the new password and, when it was sent, the current one, that of `auth.resetPassword` the reset token and the new password, and that of `auth.requestPasswordReset` and `auth.issueResetLink` the e-mail address. Anyone who can read a 0.1.0 database, or a dump, backup or copy of one, can test guesses against these digests offline at SHA-256 speed: a password against a reauthentication, a new password (paired with the current one when that was sent) against a password change, a password together with the rest of the input, the e-mail address above all, against a login or a sign-up, and an e-mail address against a reset request. 0.1.0 also stored the input of job rows (async commands, deferred invokes, enqueue effects, timers) as given, secret members included.

From 0.2.0 no digest of a command input is stored plain, and none holds a secret or verifier value; the event meta holds no personal value either. One limit stays, as in 0.1.0: a personal member declared inside a `field.json()` value is neither sealed nor reliably withheld from the digest of the decision record, so keep personal members out of json values. What was written that way stays as it is; move such members out of the json value into personal members of their own. A receipt's fingerprint still covers the personal values of its input, keyed under a key of its scope, so a guessed value can be tested against it only with the master key and the control store, and for as long as the receipt is kept. An erasure deletes the receipts it reaches or replaces their fingerprint with the text `erased`; every other receipt stays until it is deleted (for example by the receipt delete below) or, once expired, replaced by a new command under the same id. 0.2.0 cannot rewrite the records that 0.1.0 wrote.

After the upgrade, run the following once per namespace schema `<ns>`: each data namespace and the control namespace (the schema `kw__control`); every namespace schema holds a `kw_jobs` table. Run it as the owner role, the database role that owns the tables and runs the migrations (the role of the PostgreSQL adapter's `ownerUrl`). Replace `<instant of the upgrade>` by an instant with its offset, after the last 0.1.0 process stopped and before the first 0.2.0 process started, such as `2026-11-19T09:00:00Z`. The tables force row-level security, so the transaction first sets `keelwerk.scope` to `namespace`, which their row-level security policies admit:

```sql
begin;
set local keelwerk.scope = 'namespace';
-- receipts still in the 0.1.0 form
select status, count(*) from "<ns>".core__command_receipt
 where fingerprint ~ '^[0-9a-f]{64}$' group by status;
-- delete every finished receipt whose idempotency window is over
delete from "<ns>".core__command_receipt
 where expires_at < now() and status in ('completed', 'failed');
-- job rows written before the upgrade
select id, queue, state, input->>'action' as action, created_at
  from "<ns>".kw_jobs where created_at < timestamptz '<instant of the upgrade>';
-- dead letters written before the upgrade (deleting them leaves the job counters in kw_job_lane_counts unchanged)
delete from "<ns>".kw_jobs where state = 'dead' and created_at < timestamptz '<instant of the upgrade>';
commit;
```

1. Let the 0.2.0 workers run first: a 0.1.0 job runs once and leaves `kw_jobs` (its history row holds no input). The first select counts the receipts still in the 0.1.0 form by status; the receipt delete removes the finished ones whose window is over and leaves accepted receipts to the workers. Run the whole block a second time, with the same header, once the longest idempotency window of the app (the `idempotency.window` of a command, 24 hours by default) has passed since the upgrade and the 0.1.0 jobs have run. Nothing in 0.2.0 deletes finished receipts on its own, so this stays a manual step.
2. A 0.1.0 job row still listed afterwards has not run yet (state `scheduled`, `available`, `waiting` or `running`) or is a dead letter. A dead letter written before the upgrade keeps its input as given until the dead-letter delete above removes it.
3. Event meta cannot be rewritten, so the digests in it stay for as long as the events are kept. A decision record of 0.1.0 holds the bare SHA-256 of the input as `inputDigest`; from 0.2.0 no input digest is stored as a bare 64-character text: a command's decision holds `kwb1.` or `kwd1.` and an inline reaction's holds `kwr1.` (a hash of the causing event id, no input). Find the records of 0.1.0 with `select count(*) from "<ns>".kw_events where meta->'decision'->>'inputDigest' ~ '^[0-9a-f]{64}$'` (inside the same `set local keelwerk.scope = 'namespace'` transaction). Treat every password used on 0.1.0 as at risk if any copy of that database left your control or anyone you do not trust could read it, and act in this order: force a reset of those passwords; warn their users not to keep using them elsewhere; restrict who can read the database and take dumps; then shorten the retention of the backups of that period or destroy them, knowing that a destroyed backup is no longer a restore point. A backend created on 0.1.0 (`core.backend.create` with a `config`, or `keelwerk backend create --settings`) keeps, in the meta of the events its create wrote and in its receipt until that is deleted, an HMAC-SHA-256 of its configuration, secrets included, under a key of the deployment: whoever holds both the master key and the control store can test guesses of a low-entropy secret in it (an SMTP password) against that digest, so change such a secret if both may have left your control.


### Known limits

* A project created with `keelwerk init` does not start on an empty database with the compose file it ships with, in 0.1.0 as in 0.2.0. Before the first start, apply the database migrations with `keelwerk db apply`; it needs the `ownerUrl` option of the PostgreSQL adapter, set to a connection of the database owner role. Then start the application.
* When the PostgreSQL server ends a connection that a unit of work or a schema operation holds (a failover, an administrator ending the backend, a timeout on the server), the connection emits an `error` event that nothing handles, in 0.1.0 as in 0.2.0. Node.js treats that as an uncaught exception, so the process ends unless the application handles uncaught exceptions itself. The fix ships in the next release.
* A caller without an identity who repeats a finished command is answered from the recorded outcome when the command id and every member that is not a secret are the same, whatever secret members the repeat carries. Whoever holds the command id of such a call and its other input within the receipt window (24 hours by default) learns its outcome. In the modules of this release that is whether a login, a sign-up or a password reset succeeded; no session, token or password is exposed. Until the fix ships in the next release: do not return a value that a secret member guards from an action that anonymous callers may run.


### ⚠ BREAKING CHANGES

* **core:** 0.1.0 stored the plain SHA-256 of the input of every command whose input carried no sealed value, every module-auth command among them, so passwords and e-mail addresses included, in the command receipt and in the meta of every event the command wrote, and stored the input of job rows (async commands, deferred invokes, enqueue effects, timers) as given, secret members in clear. 0.2.0 cannot rewrite those records; the event meta is chain-hashed. Follow the Security section above: delete the expired receipts, review the job rows 0.1.0 wrote, and treat every password used on 0.1.0 as at risk if any copy of that database left your control or anyone you do not trust could read it.
* **core:** stored digests have a new form: none is a bare 64-character SHA-256 any more, and every digest of a command input is an HMAC-SHA-256. Each command has two, both HMAC-SHA-256 under the scope's fingerprint key (HKDF of the scope key, info `keelwerk/fingerprint/v1`) over the canonical action, API version and input. The receipt's fingerprint is `kwf1.` and 64 hex characters; in its input the value of every secret and verifier member is replaced by the marker `kw:withheld`. The decision base is `kwb1.` and 64 hex characters; in its input personal members are replaced as well. The `inputDigest` of a command's decision record is the decision base, or `kwd1.` and 64 hex characters when the decision sealed personal values; it is never the receipt's fingerprint. The `inputDigest` of an inline reaction's decision record is `kwr1.` and the SHA-256 of the causing event id; 0.1.0 stored that SHA-256 bare. Records written by 0.1.0 keep their 64 bare hex characters, and 0.2.0 writes no bare fingerprint or `inputDigest`. A personal member declared inside a `field.json()` value is not reliably withheld and is not sealed, as in 0.1.0: keep personal members out of json values. Code that compared or recomputed a receipt's fingerprint or an `inputDigest` must stop doing so.
* **core:** a retry with the same command id and principal whose input differs only in a secret or verifier member answers the recorded outcome, the recorded failure or `core.command_in_progress` instead of `core.idempotency_mismatch`; for a backend create this holds for every configuration value, while a retry that names other modules or members in `config` still answers `core.idempotency_mismatch`. A retry whose input differs in a personal member still answers `core.idempotency_mismatch`. A client that corrects a password after a refusal sends a new command id. A receipt written by 0.1.0 is compared in its own form, so a retry across the upgrade whose command id and input 0.2.0 accepts answers as it did on 0.1.0. A retry on 0.1.0 of a command first run on 0.2.0 may answer `core.idempotency_mismatch`.
* **core:** compose refuses a `field.secret()` or `field.verifier()` inside a `field.json()` member of an entity field, of a command's input, output or `outcomeWith`, of an effect's input or output, or of a module configuration, with the composition error `credentialInJson`. The kernel seals a credential only as a top-level member or as an element of a list or set, so the value would have been stored in plaintext in a row, a job, an effect record or a receipt. An application moves the credential out of the json value into a member of its own (`field.secret()` at the top level of the shape, or a list or set of them) and reads it from there.
* **core:** compose refuses a `field.verifier()` in a command's input, output or `outcomeWith`, in an effect's input or output and in a module configuration, with the composition error `verifierOutsideEntity`: a verifier belongs in an entity's fields, and in those places it would have been stored unsealed in a job row, an effect record or a receipt. An application issues the verifier inside the decision that writes it (`ctx.secrets.issue`) and writes it into the entity field there, instead of passing it through an input or returning it.
* **core:** a job whose command is a generated write is refused with internal `core.request_not_allowed` when its row would hold a credential or personal value unsealed: a verifier field in any generated write, or a secret or personal field in the patch of a generated update or in an item of a generated set. The unit that asked for the job fails: the decision for an enqueue, a timer or a deferred invoke, and the settle of the effect for a continuation; the same refusal applies to the job of a schedule tick, of a timer a principal resolver sets and of an async command. Write such a value in the decision that has it.
* **core:** explain shows no digest in the 0.1.0 form: trace and re-decide show `withheld` in place of a recorded `inputDigest` that is not in a 0.2.0 form (`kwb1.`, `kwd1.` or `kwr1.`). A dry run shows a digest in the 0.2.0 form and never stores a key: where the scope already has its fingerprint key, a `kwb1.` text is the one a real run of the same input stores, while a `kwd1.` text also depends on the data keys of the run and can differ from what a real run stores; where the scope has no fingerprint key, the text belongs to that dry run alone. A re-decide checks a 0.1.0 decision against its 0.1.0 digest, secrets included, as before; against a 0.2.0 decision it checks the decision base, so it no longer checks the secret, verifier and personal members of the supplied input.
* **module-auth:** an app that composes auth with accounts needs an event worker that runs asyncReactions, `consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] })` of `@keelwerk/events`; without it the boot is refused with `asyncReactionsUnavailable` for `auth.recordLogin`. Workers must also serve the reactions, timers and hooks queues, and the commands queue for the extension rows 0.1.0 left pending.
* **module-auth:** lastLoginAt is written by a job after the login commits, so it is absent until that job ran, and a password change no longer sets it.
* **module-auth:** auth.login appends auth.credential.loggedIn ({ at }) and no credential changed event, except for a rehash of the verifier.
* **module-auth:** a new password must be 15 to 256 code points (minPasswordLength 8 to 64, default 15) at signUp, resetPassword and changePassword, or the call fails with `core.validation` and an issue path. Login and reauthenticate are unchanged, so a stored shorter password still signs in.
* **module-auth:** a login or a password change is refused with `core.rate_limited` and writes nothing once the credential holds successfulLoginsPerMinute (default 6) sessions authenticated in the last minute; a reauthentication of a session counts like a login, and a wrong password never counts. A reset request is no longer refused per identifier: within the address limit it answers accepted, and at most resetRequestsPerHour (default 3) links are delivered per credential per hour.
* **module-auth:** a reset link stops working when a newer one is issued for the same credential, by a request or by auth.issueResetLink. Two deliveries that run at the same moment can each leave a live link, both for the same credential and address, and pass the hourly cap by the number of overlapping deliveries.
* **module-auth:** the identifier input of auth.login, auth.signUp, auth.requestPasswordReset and auth.issueResetLink is now personal, so the digest of the decision record withholds it, and a receipt written by 0.2.0 holds no plain SHA-256 of it; a receipt written by 0.1.0 keeps its own until it is deleted or replaced (see the Security section). A retry of one of these commands across the upgrade under the same command id, in a form 0.2.0 accepts, answers as it did on 0.1.0.
* **module-auth:** the sign-up of an address that already has a profile answers `auth.identifier_taken` without details, no longer `accounts.email_taken`.
* **core:** onTenantCreated hooks run as jobs on the hooks queue after the tenant commits, so the tenant is usable before they ran, and a deployment with no worker on that queue never runs them. The worker records hookFailed and hookCompleted; a hook that fails with a retryable error is retried, and any other failure ends the job at once as a dead letter named after the hook. rerunTenantHooks runs a failed hook again and first cancels its pending or running job.
* **core:** an effect executor on the queue hooks is refused at compose (`executorQueueReserved`).
* **module-auth:** sessions now slide. A browser cookie request under host-based tenant resolution whose extension is due gets the cookie set again with the new expiry, with Cache-Control private, no-store; a bearer token never becomes a cookie, and a logout clears it.
* **module-auth:** the extension rows that 0.1.0 left pending (`auth.extend:<session id>`) run once after the upgrade and extend nothing, since they carry no instant of their request. For a session that is revoked or expired, or whose credential is revoked, the job ends as a failed job with `core.unauthenticated` and no dead letter.
* **module-auth:** the reset token is delivered by the job auth.deliverPasswordReset on the timers queue, not in the request. That action and auth.revokeSessions join the API surface, OpenAPI and the CLI, and admit only the module's service principal.
* **module-auth:** auth.revokeSubject revokes the credentials in the deactivating unit and the sessions in the job auth.revokeSessions, one page at a time; a subject with 1,000 or more sessions no longer fails the deactivation.
* **core:** `kernelCommandId` accepts the kind `'hook'`, and `JobStore.cancel` also cancels the running attempt of a job in the hooks queue, as it does in the timers queue; the `JobStore` of a custom adapter must do the same (`cancelsRunningAttempt` names those queues).
* **core:** a command id a caller chooses must be a UUID of version 4 or 7 (either case), or a ULID. This covers the REST Idempotency-Key header, the commandId of an HTTP, GraphQL or programmatic invocation, `--command-id` of `keelwerk tenant create` and `keelwerk backend create`, and a module's `enqueue({ commandId })`. Any other text is refused before the receipt is read. HTTP answers `core.malformed_request` with the issue 'Expected a UUID of version 4 or 7, or a ULID.' at path commandId; GraphQL answers `core.malformed_request` with the same text at path input.commandId; REST answers `core.malformed_request` with 'Idempotency-Key: Expected a UUID of version 4 or 7, or a ULID.'; an invocation and an enqueue answer validation 'A command id is a UUID of version 4 or 7, or a ULID.' at path commandId (an enqueue fails the decision). The sync client id follows the same rule: validation 'A client id is a UUID of version 4 or 7, or a ULID.' at path clientId. 0.1.0 accepted 1 to 255 visible ASCII characters over REST and any non-empty string elsewhere. Receipts and jobs stored under an older id stay and their jobs run. A retry that repeats such an id never runs the command, so a client retrying across the upgrade sends a new id. A module that built deterministic command ids omits commandId (the kernel derives one per decision) or deduplicates with `key`. There is no supported way yet to turn a natural key from outside into a command id; until then use a random id and deduplicate in the module, or `key` on an enqueue.
* **core:** a row id a module names in `create({ id })` must be a UUID of version 4 or 7, else the decision fails with internal `core.request_not_allowed`. Every other form is refused: a ULID, a UUID of any version other than 4 and 7 (1, 2, 3, 5, 6 or 8, an id from deriveUuidV8 included, and the nil and max UUIDs) and any text that is no UUID. Take the id from ctx.newId. A re-decide of a 0.1.0 decision that named such an id reports a difference.
* **core:** a timer or enqueue key is stored as `<module id>:<digest>` and the key of an external effect as the digest. A timer or enqueue row of 0.1.0 keeps its bare key text, so cancelTimer or a new enqueue of that key no longer reaches it, and a re-decide of a 0.1.0 decision that requested an effect with a key reports the key as a difference. 0.1.0 ran no worker, so each such row runs once at its run_at and then leaves `kw_jobs`, or stays as a dead letter until an operator acts. An operator lists the rows that keep a bare key, per namespace schema `<ns>` and as the owner role (row-level security is forced on `kw_jobs`, so without the setting the query answers no rows), with:

  ```sql
  begin;
  set local keelwerk.scope = 'namespace';
  select id, scope_id, queue, kind, state, run_at, key from "<ns>".kw_jobs
   where kind = 'action' and queue in ('commands', 'timers', 'hooks') and key is not null
     and key !~ ':[0-9a-f]{64}$' and key !~ '^core\.(deadline|continuation|hook):';
  commit;
  ```

  The query leaves out the rows that 0.2.0 keys itself: effect jobs (the deadline timers of external effects among them), schedule ticks, reaction jobs, and the continuation and hook jobs. A row it lists keeps its key text until it runs; an operator who must not keep the text deletes the row, and the job does not run.
* **core:** an erasure leaves in the events a 0.1.0 deployment wrote the plain input digests and command ids in their meta, the lengths of `$kwe` version 1 values and the text keys of requested effects; these are chain-hashed and are not rewritten, by an erasure or by the upgrade, so the digests of an erased person's 0.1.0 commands stay as the Security section describes.
* **core:** `sealKwe` seals version 2 unless its fifth argument is 1, and the `$kwe` of `KweEnvelope` is `1 | 2`; a caller that rebuilds a version 1 envelope passes 1 as that argument.
* **core:** a re-decide needs a key service that derives, also for a command without secrets; a scope that has no key is not_found there and is given none. `KeyService.derive` takes an optional `{ create: false }`: an implementation outside core must honour it by creating nothing and answering not_found. How a retry across the upgrade is answered, and what a receipt's fingerprint and an `inputDigest` hold, is described in the bullets "stored digests have a new form" and "a retry with the same command id and principal" above.
* **core:** a new framework migration (framework step 0003) adds ledger indexes to the control schema `kw__control` at the first boot of a 0.1.0 deployment, with the control ledger locked while they build. That boot records cluster identities and marks, and bumps no scope unless the scope's head lies below its newest anchor (a store restored under 0.1.0). Every boot reads each ledger sink once, so start-up time grows with the sink's history.
* **core:** a process that starts while an erasure is pending refuses that tenant with `core.unavailable` until the erasure completes, which takes an event worker that runs erasure (`erasure()` of `@keelwerk/events`).
* **core:** the signal of a RuntimeServiceContext aborted only when the process stopped. It now also aborts when the process leaves service, and a custom runtime service or event worker must stop its work then.
* **core:** a custom adapter must provide JobStore.keyed, ControlLedger.find and ControlLedger.unfinished, and its JobStore must honour the retry outcome uncounted (give the attempt back), or the jobs of a held tenant use up their retries. A fake of Runtime must provide outOfService, a promise that settles once the process found a restore under itself and recorded its evidence.
* **core:** keelwerk start exits with a failure when it finds a restore under the running process, so its supervisor must restart it. A promotion of a standby, planned or not, counts as a restore: client tokens are reset, completed erasures run again and their tenants are held meanwhile.
* **deps:** @keelwerk/biome-config peers on Biome 2.6.8 exactly (2.6.3 in v0.1.0). An application that extends the preset installs exactly that version, and moves it with every upgrade of the preset.
* **core:** the stored key of a keyed enqueue now begins with the id of the module that enqueued it (`<module id>:<digest>`, see the note on timer and enqueue keys above), so two modules of one scope no longer keep each other's job. A pending commands job written by 0.1.0 keeps its bare key. 0.1.0 ran no worker, so such rows are still pending, and each runs once when a 0.2.0 worker takes it. The idle extension rows that auth left pending run once and extend nothing, as the module-auth note on them says. A row of an app module runs, and the module's enqueue of the same key is now stored apart and runs as well: a mail enqueued under "welcome:u1" before the upgrade and again after it is sent twice. A 0.1.0 row no longer absorbs an enqueue of 0.2.0, whatever its key text: a 0.1.0 row of module billing with the bare key "invoice:42" does not hold back the enqueue of key "42" by module invoice, and a 0.1.0 row whose key began with the enqueuing module's id and a colon does not hold back that module's enqueue of the rest of the key.
* **core:** a timer row written by 0.1.0 keeps its bare key: no setTimer or cancelTimer of 0.2.0 replaces or cancels it, whatever its key text, also when that key began with the module's id and a colon. Before the upgrade, while every row is still a 0.1.0 row, find such rows per namespace schema `<ns>` and as the owner role with:

  ```sql
  begin;
  set local keelwerk.scope = 'namespace';
  select id, scope_id, key from "<ns>".kw_jobs
   where queue = 'timers' and kind = 'action'
     and (key !~ ':[0-9a-f]{64}$' or principal->>'principalId' is distinct from split_part(key, ':', 1) || '.system');
  commit;
  ```

  Then delete them, and their jobs never run, or let them fire once.
* **events:** a SQL store whose rows have a data subject needs a key wrapper; field.subject() refuses a 128-bit value in upper case.
* **transport-http:** a route mounted on the HTTP host answers an event stream only to a request that asks for one. Such a request passes the host's stream origin check and holds a stream slot; an event stream answered to any other request is refused with `core.internal`.
* **core:** `settle()` takes the effect id typed as `Id<'core.effect'>`, not a string, so a decision that settles an effect passes a typed id.
* **core:** an effect of an external performer takes no runAt.
* **core:** a module's principal resolver may not answer an operator, and the reference of its answer names the resolver itself; an answer that breaks either rule fails the request with `core.internal`.
* **module-auth:** module-auth refuses the commands that change how a person signs in (credential and session revoke, logout, reauthenticate, extendSession, changePassword) to a user no auth session resolved.
* **core:** an action's deprecated.at and sunset must be a calendar date or an instant with an offset; other texts are refused when the action is defined.
* **core:** DeprecationNotice.at is optional, because a deprecation without a date is announced too.

### Features

* **cli:** render transport type fragments into app generated files ([c7371b4](https://github.com/JensPenneman/keelwerk/commit/c7371b4767fbfe03642126eb9a7664a9aad509bf))
* **core:** add effect status query and watch actions ([f98537d](https://github.com/JensPenneman/keelwerk/commit/f98537dab75cc737589318d2b44cc0fa91dcedd7))
* **core:** add streams, topics, processes, version changes and quotas ([14bb27c](https://github.com/JensPenneman/keelwerk/commit/14bb27cd1d3b25607d110f59ed0359dcf0b486ae))
* **core:** append-only streams with a record store on every adapter ([ec4e6af](https://github.com/JensPenneman/keelwerk/commit/ec4e6af81dc73d89fd50d336e163e2d65560ba18))
* **core:** bound reaction chains and cache process state folds ([8be023c](https://github.com/JensPenneman/keelwerk/commit/8be023ceaee5988d116f0e720016e277f9b481e7))
* **core:** count API usage and retire sunset API versions ([301fdd8](https://github.com/JensPenneman/keelwerk/commit/301fdd82860e20a40391a0cb2dc6fc862282dac4))
* **core:** detect restored stores and re-run erasures before serving ([a503c37](https://github.com/JensPenneman/keelwerk/commit/a503c3743b4fa9cc24ec1bde2e8398daeb4359a4))
* **core:** evaluate feature flags once per invocation ([21429a9](https://github.com/JensPenneman/keelwerk/commit/21429a9348c45f483778156a7ce3723048a1d158))
* **core:** key job ids and fingerprints, require opaque ids ([18d3aa9](https://github.com/JensPenneman/keelwerk/commit/18d3aa9e102f51e847a52e78bc31290898ee45bf))
* **core:** key job ids and fingerprints, require opaque ids ([c520004](https://github.com/JensPenneman/keelwerk/commit/c52000465209a9e32e52358363e3b0529de4f736))
* **core:** let outside performers settle effects, with deadlines ([f1c3554](https://github.com/JensPenneman/keelwerk/commit/f1c3554a5ad1d0d7f0d7396c5cc870b25693900b))
* **core:** namespace timer job keys by module ([0c18a22](https://github.com/JensPenneman/keelwerk/commit/0c18a22c9b4c1aa57cbd77697227114a07dd30f7))
* **core:** run effect executors from the worker with recorded attempts ([8b635fe](https://github.com/JensPenneman/keelwerk/commit/8b635fe899456ef8e67f02f6caafdec8e5d7e7d1))
* **core:** run queued jobs and async commands with real workers ([c984cd1](https://github.com/JensPenneman/keelwerk/commit/c984cd19690bd07680e72efcb574ffd312bea66f))
* **core:** scope enqueue keys per module and name kernel job keys ([33a0100](https://github.com/JensPenneman/keelwerk/commit/33a010052166efb850f2dc0ac15c6c58b6f8f781))
* **core:** seal personal and secret values in effects and receipts ([8b993d7](https://github.com/JensPenneman/keelwerk/commit/8b993d7f4f42f1787a6458998518b49505c012ac))
* **core:** share one list of error kinds across packages ([a6791f6](https://github.com/JensPenneman/keelwerk/commit/a6791f65c15786720ca3f7dfdd050bf94cf7ed6d))
* **core:** show matched rule ids and failed stage in explain stream ([e8cf04d](https://github.com/JensPenneman/keelwerk/commit/e8cf04db8663fdd8ed3c47e92b1119ccc64b00d5))
* **core:** target feature flags with rules and percentage splits ([1b16575](https://github.com/JensPenneman/keelwerk/commit/1b16575431faadb30202804b3ecd2cccb2eac4d9))
* **core:** tick schedules and fire timers with sealed job inputs ([f1457c3](https://github.com/JensPenneman/keelwerk/commit/f1457c308cb618f08156bedb1db16d6b5fa4941b))
* **core:** tie a settle to its performer and guard live leaves ([209889c](https://github.com/JensPenneman/keelwerk/commit/209889c6e3a3b91343386eecf21673bed4ef4824))
* **core:** translate requests and answers between API versions ([ba20987](https://github.com/JensPenneman/keelwerk/commit/ba209870967045d9cdac0655d5663f7c4386f6f8))
* **events:** erase a data subject across streams, keys, jobs and ledger ([50e37f4](https://github.com/JensPenneman/keelwerk/commit/50e37f4ca574ec0ceaaa2adfff1d13321a0762e8))
* **events:** run async reactions and process managers from events ([779038c](https://github.com/JensPenneman/keelwerk/commit/779038cbe4e586a09f6255ecf728ea5a69a4669c))
* **events:** run consumers with leases, parking and replay ([651cdd7](https://github.com/JensPenneman/keelwerk/commit/651cdd7f6fa809f6345fc69e4c8c8ae3b54eb204))
* **live:** generate watch actions and a pokes stream for entities ([267407b](https://github.com/JensPenneman/keelwerk/commit/267407b4ebe0d0f43dbd936da2bd39c2d4bb7b26))
* **live:** serve subscriptions through a live hub for each runtime ([a5506e0](https://github.com/JensPenneman/keelwerk/commit/a5506e0a36c523415bfe8189d6de1940e6d829b1))
* **live:** stream tickets and an SSE carrier for live subscriptions ([6772679](https://github.com/JensPenneman/keelwerk/commit/67726790e07009e57e46d4f8fa45deed0428235a))
* **module-api-keys:** add personal API keys that sign in as their owner ([772c4b7](https://github.com/JensPenneman/keelwerk/commit/772c4b7d89a994b232c52b1a226385da823343af))
* **module-auth:** record logins in jobs and renew sliding sessions ([776d8e8](https://github.com/JensPenneman/keelwerk/commit/776d8e800f846525ec8539e981e370a86b33e704))
* **testing:** drive live socket cases through a connect hook ([72e85ac](https://github.com/JensPenneman/keelwerk/commit/72e85ac75804c6ed3f9cb09a8793338f69485541))
* **testing:** host transports in the test runtime, one address per call ([9ac1125](https://github.com/JensPenneman/keelwerk/commit/9ac11254bdb05b625234b587e273c0e0bebc4894))
* **transport-graphql:** add subscriptions over SSE and graphql-ws ([baaf1b3](https://github.com/JensPenneman/keelwerk/commit/baaf1b32285977705168d40694fd0962d6606f00))
* **transport-graphql:** serve the surface over GraphQL ([2e9e5f5](https://github.com/JensPenneman/keelwerk/commit/2e9e5f5e4b02220d38544406414271bdeab8b793))
* **transport-http:** serve live subscriptions over a websocket ([d910289](https://github.com/JensPenneman/keelwerk/commit/d910289d9e14abe0ca862aaf1de6291c4dd41208))


### Bug Fixes

* **core:** decode public ids inside filters ([8a9d484](https://github.com/JensPenneman/keelwerk/commit/8a9d4848c215cfcc6d58cc0e06a65cf1673be1a1))
* **core:** keep secrets and verifiers out of every stored digest ([f8ed7b4](https://github.com/JensPenneman/keelwerk/commit/f8ed7b465236150289fd9ce46c123409870917c9))
* **core:** leave an omitted field untouched in a generated update ([f4e8c10](https://github.com/JensPenneman/keelwerk/commit/f4e8c10cb3c8be3eddd7f7e285ba3de53fea2495))
* **core:** trim the OTLP endpoint without a regular expression ([ed90776](https://github.com/JensPenneman/keelwerk/commit/ed90776484a7c3aa9c481548c50c8b6af8d1d33d))
* **data:** refuse statements on a unit that has ended ([16a5846](https://github.com/JensPenneman/keelwerk/commit/16a5846867a3e0fad7813d7b72f1d5dc52a2d384))
* **deps:** update hono and its node server for seven advisories ([cf8b28f](https://github.com/JensPenneman/keelwerk/commit/cf8b28fbee63a62e99fa8041f75a78df4a71d618))
* **events:** stop reaction jobs of deployment events dying ([a00342f](https://github.com/JensPenneman/keelwerk/commit/a00342f3065b97a4df8eae318c65048d5a43d554))


### Miscellaneous Chores

* **deps:** move every dependency to its newest release ([92625fb](https://github.com/JensPenneman/keelwerk/commit/92625fbe6e3b233f502803b61dd67177065c3082))

The scopes module-api-keys and transport-graphql in these notes name packages that are in the repository but are not published to npm yet: @keelwerk/module-api-keys and @keelwerk/transport-graphql.

## 0.1.0 (2026-11-11)


### Features

* **accounts:** the accounts module alone ([b0a97f0](https://github.com/JensPenneman/keelwerk/commit/b0a97f0f23d5876df555a363415692089e995247))
* **adapter-postgres:** add the driver, pool, units and identity ([1dac206](https://github.com/JensPenneman/keelwerk/commit/1dac206620885a45eafb10748ae7254ccc10c3f6))
* **adapter-postgres:** add the notifier, the change feed and the fallback report ([af10272](https://github.com/JensPenneman/keelwerk/commit/af10272712c84ca959fa7f20eb9b3d6f0dfabf84))
* **auth:** auth with accounts ([a42b04b](https://github.com/JensPenneman/keelwerk/commit/a42b04bc067ea2ae1f40a0b1499acf7d02de17f3))
* **auth:** the auth module alone ([c94bd09](https://github.com/JensPenneman/keelwerk/commit/c94bd09cc0b815bd3f3af315fe48ea7732a3018e))
* **biome-config:** ship the gritql plugins and their fixtures ([60b6b29](https://github.com/JensPenneman/keelwerk/commit/60b6b29fc93de6340048bb9d3a2418c41d9966fd))
* **cli:** add keelwerk doctor and the layout pass ([420f8ac](https://github.com/JensPenneman/keelwerk/commit/420f8ac51d5e62346006c3135aac6c77dac37981))
* **cli:** add the command skeleton, profiles and call ([8f90683](https://github.com/JensPenneman/keelwerk/commit/8f90683503b9f4f4cb86e777ed049a5fe93c704d))
* **cli:** dev, start, build and init ([f476c29](https://github.com/JensPenneman/keelwerk/commit/f476c292229e5215584a393997697584caa3a88c))
* **client:** add the typed client ([0570825](https://github.com/JensPenneman/keelwerk/commit/0570825f5a6ae26f50a19a325184057bb228298c))
* **cli:** generate, db and surface commands ([956a517](https://github.com/JensPenneman/keelwerk/commit/956a517c1393cac86aab7c967314a97f0743cbae))
* **cli:** report ledger sinks that refused appends in doctor ([b06db37](https://github.com/JensPenneman/keelwerk/commit/b06db37d2407283aa4c04779671e4bca113d5022))
* **cli:** scaffold parts and modules with keelwerk new ([67c9142](https://github.com/JensPenneman/keelwerk/commit/67c91427bf3d0d0d376593a78c935364c7095149))
* **cli:** the CLI against a running deployment ([0b39370](https://github.com/JensPenneman/keelwerk/commit/0b393707ddfcda3d1f011a3407a8b64b04a53fc6))
* **core:** add dated api versions, pins, the ledger and the surface diff ([bdce44d](https://github.com/JensPenneman/keelwerk/commit/bdce44d6046eabc95cbfb13df1aba3a88b0b32f1))
* **core:** add explain with dry runs and traces ([b82c634](https://github.com/JensPenneman/keelwerk/commit/b82c6341f55c685020354780d738267a33cd411d))
* **core:** add live, flag, effect and selection-limit contract types ([0444758](https://github.com/JensPenneman/keelwerk/commit/04447585f16bf7509182b68c31c21108f3e6e5c3))
* **core:** add storage, job, edge, runtime and event contract types ([609699a](https://github.com/JensPenneman/keelwerk/commit/609699aea98af483d40aae4fb5321346ed7d5cdb))
* **core:** add the app, deployment, api version and core-module types ([f32afba](https://github.com/JensPenneman/keelwerk/commit/f32afba07aeda55febf2e26a8f1d47d58e51c42f))
* **core:** add the authorization engine ([c8dd183](https://github.com/JensPenneman/keelwerk/commit/c8dd18399b75528e60cbb1454044faa16db37e1c))
* **core:** add the command write path and receipts ([cfc1c00](https://github.com/JensPenneman/keelwerk/commit/cfc1c00f3304ac09e2d0fe517a2bc820dff556e1))
* **core:** add the control store, the lifecycle phases and startRuntime ([9497f7d](https://github.com/JensPenneman/keelwerk/commit/9497f7d8e4b2714e40304ab6bb063a3b03412aa5))
* **core:** add the field model, shapes, ids and entities ([2e3e1dd](https://github.com/JensPenneman/keelwerk/commit/2e3e1dda217922bc64d88f2199399c38bcb3abe2))
* **core:** add the interpreter and the read path ([a62a91d](https://github.com/JensPenneman/keelwerk/commit/a62a91d1f841378a7cb5f0ceb40c3e530a80033f))
* **core:** add the invoker, sessions and the request pipeline ([d363a48](https://github.com/JensPenneman/keelwerk/commit/d363a488a7670bf0971116757b8dd87eb62b4c2d))
* **core:** add the kernel primitives ([f1fa8c5](https://github.com/JensPenneman/keelwerk/commit/f1fa8c5bc1c58af9da16b16ce3781a1a6832350f))
* **core:** add the key service, sealing and the computation pool ([4cf2080](https://github.com/JensPenneman/keelwerk/commit/4cf2080aab44ca2fc735c41436c343fda455ad4d))
* **core:** add the module dsl, the part contexts and the effect constructors ([10f77f0](https://github.com/JensPenneman/keelwerk/commit/10f77f041ecb95724d72777fd47a96c793fe1566))
* **core:** add the wire codecs, field nodes and json schema ([7e1f8d3](https://github.com/JensPenneman/keelwerk/commit/7e1f8d325197b275c3f9032ce738c299b705c1ce))
* **core:** anchor chain heads to ledger sinks and verify against them ([d54fe91](https://github.com/JensPenneman/keelwerk/commit/d54fe9165da987e3633e2a91bc5e32468400325c))
* **core:** compose apps into the registry ([c1397f9](https://github.com/JensPenneman/keelwerk/commit/c1397f9af0153d26bf841f6f2b92d1971ca52a24))
* **core:** derive the api surface and render the app's generated file ([d2c21b1](https://github.com/JensPenneman/keelwerk/commit/d2c21b1497ec84e232f810f9564170b849fd9e8f))
* **core:** freeze the edge contract types ([bcb76ca](https://github.com/JensPenneman/keelwerk/commit/bcb76ca561654e8752e521be1d0ab05ba65058ae))
* **core:** freeze the kernel contract types ([74f4bb9](https://github.com/JensPenneman/keelwerk/commit/74f4bb941eebd8af70ba903cd4a4519da1b628e2))
* **core:** freeze the registry entries and kernel service types ([caeae54](https://github.com/JensPenneman/keelwerk/commit/caeae54610fc9b877771798b4183498c55327577))
* **core:** generate the module manifest and add the library fixture ([ce9104c](https://github.com/JensPenneman/keelwerk/commit/ce9104ca08cf67fc1011cda834700cf5cea64f90))
* **core:** let the runtime own the host and export traces over OTLP ([2591da5](https://github.com/JensPenneman/keelwerk/commit/2591da5e2eb5d42e4409b2271d2d35d8673f061a))
* **core:** mark entity outputs on action entries and abort reads on signal ([bf97ab3](https://github.com/JensPenneman/keelwerk/commit/bf97ab3726c34ea0f54cee7cd7138f77fc96586e))
* **core:** normalise and evaluate conditions in memory ([329939f](https://github.com/JensPenneman/keelwerk/commit/329939f696d483c65d8d79f7a278bcdd54ca6bb5))
* **core:** operator tokens, me, capabilities and tenant entry ([e2c79a4](https://github.com/JensPenneman/keelwerk/commit/e2c79a4bfaebea2e75122f3268810f083b4507ef))
* **core:** perform kernel effects, run inline reactions and accept asynchronous commands ([ae4102c](https://github.com/JensPenneman/keelwerk/commit/ae4102cc7a6a682dcc7bd95ae95c9ddfd0cc5fe1))
* **core:** record decisions and chain events with hashes and hybrid clocks ([ff88186](https://github.com/JensPenneman/keelwerk/commit/ff8818683364ed48eb6bf121ba07a8d5bc12fc50))
* **core:** refresh the ledger's head entry from the sources ([30ce13f](https://github.com/JensPenneman/keelwerk/commit/30ce13fb62679aa3e0e407ae9b145451b1419a03))
* **core:** run admission rules and rate buckets at admit ([2c41092](https://github.com/JensPenneman/keelwerk/commit/2c41092367d02ade97e2ccadd9a6ec8ed19c2b1a))
* **core:** scaffold the second-milestone packages and registration points ([4d1ad45](https://github.com/JensPenneman/keelwerk/commit/4d1ad453f585c0740ec589bb7d2bf5261baa7b94))
* **core:** seal credentials and answer secret requests in the kernel ([4284e27](https://github.com/JensPenneman/keelwerk/commit/4284e27dc7464ddf07bf9d7bb8bbca04f097af05))
* **core:** seal personal fields under the data subject's key ([6072cbf](https://github.com/JensPenneman/keelwerk/commit/6072cbf94f99086843930be270bef97c106882ee))
* **core:** serve the generated entity actions with state tokens and the disclosure rule ([64167e3](https://github.com/JensPenneman/keelwerk/commit/64167e3b27f9dc485ba59defaeca867b9f5c199e))
* **data:** add the framework tables and their row-level security ([619f2ee](https://github.com/JensPenneman/keelwerk/commit/619f2ee7a935d648c73dbda2a71ee630f11a4b45))
* **data:** add the in-memory adapter ([dcf47e4](https://github.com/JensPenneman/keelwerk/commit/dcf47e470d4029fe61a105153996779a0d20966f))
* **data:** add the migration planner and schema operations ([ae52709](https://github.com/JensPenneman/keelwerk/commit/ae52709df3510940d8460f7f37ec47caf58cc546))
* **data:** add the sql event store, the commit tail and job enqueue ([64ca7d2](https://github.com/JensPenneman/keelwerk/commit/64ca7d2b179b14aad517c073613d2d5518aab94a))
* **data:** add the sql family compilers, codecs and the scoping plugin ([4475110](https://github.com/JensPenneman/keelwerk/commit/447511030a08969e90d8d9a31edf0e12c9e5b558))
* **data:** add the sql unit and the first postgresql stores ([28eb664](https://github.com/JensPenneman/keelwerk/commit/28eb6640d5f9c93a5af28e1235764fdb93a2cee2))
* **data:** add the twelve framework tables as a migration track ([ad2f959](https://github.com/JensPenneman/keelwerk/commit/ad2f95957766d7f70d39356004ef50904184db63))
* **data:** complete the job store with promote, fair take, heartbeat, completion and stats ([2445f26](https://github.com/JensPenneman/keelwerk/commit/2445f26c84aa408708bdf1dde86de8eecb14fcc2))
* **data:** wire pglite as an in-process adapter ([bd2eae2](https://github.com/JensPenneman/keelwerk/commit/bd2eae27ecc4d7a5f2782b2eb68ada82125c5f42))
* **portal:** slice 4, the portal over REST ([cae5d19](https://github.com/JensPenneman/keelwerk/commit/cae5d190fc32e49052005e40d7d81e2d2839131c))
* **portal:** slice 5, the portal from a fresh clone ([f335979](https://github.com/JensPenneman/keelwerk/commit/f335979539a97f772ef88446b616b86e3d0aa57d))
* scaffold every m1 package and the seed types ([f9cbca4](https://github.com/JensPenneman/keelwerk/commit/f9cbca4561d5faab63a5994920f4409f8423ec6b))
* **testing:** add drive, in-memory runs and re-decide ([7d55874](https://github.com/JensPenneman/keelwerk/commit/7d55874922dbc2dae30efcc66016f83faafa29c6))
* **testing:** add the adapter conformance kit and run it on the in-memory adapter ([e5c6b49](https://github.com/JensPenneman/keelwerk/commit/e5c6b49a1e0fca51df803adc084b976957b4542d))
* **testing:** add the harness, the local client and slice 1 ([0db6637](https://github.com/JensPenneman/keelwerk/commit/0db663797aeb54529439ddd8e88689dca8482358))
* **testing:** run slice 2 on PostgreSQL, PGlite and in-memory ([646aed1](https://github.com/JensPenneman/keelwerk/commit/646aed121a622ccf018f4ef0a151c5680f2cd1c7))
* **testing:** start postgresql 18 for integration tests ([f2b3289](https://github.com/JensPenneman/keelwerk/commit/f2b328985280021d9222b8a472859dd86038e1f2))
* **transport-http:** add the http host and the invocation protocol ([d898cb7](https://github.com/JensPenneman/keelwerk/commit/d898cb7c74134353b09375d25cfd29b6fd7c382f))
* **transport-rest:** add the rest transport runtime ([55d8ef0](https://github.com/JensPenneman/keelwerk/commit/55d8ef0003c4c56e34493d1ee7d70841fce51926))
* **transport-rest:** emit the openapi document and check the rest surface ([9041f55](https://github.com/JensPenneman/keelwerk/commit/9041f557f2ad555e19de3b47e7d08ce177a1675d))
* **transport:** slice 3, the transports against the kernel ([17c6474](https://github.com/JensPenneman/keelwerk/commit/17c647465eaa13267592ea162093f63ad2430d0c))
* **type-budgets:** gate the type budgets in ci ([dcc5057](https://github.com/JensPenneman/keelwerk/commit/dcc5057efab8619cf95f05bfb3360b89850922a6))


### Bug Fixes

* **cli:** create the dev and test socket directories with mode 0700 ([65e5ebe](https://github.com/JensPenneman/keelwerk/commit/65e5ebee738c51c5709b049bdb0d3bffeb0d49c6))
* **cli:** fail the dev probe on a stall, not on a slow machine ([556f18a](https://github.com/JensPenneman/keelwerk/commit/556f18a6af2fdc2a19590f49cfb46d6ddd08a671))
* close the code scanning findings ([2ff8bba](https://github.com/JensPenneman/keelwerk/commit/2ff8bba1941e92bda9b01774b941fd6b2ea6fefd))
* **core:** align flag reasons, queue lanes and app policies with the register ([30e21ed](https://github.com/JensPenneman/keelwerk/commit/30e21ed3c82687f0431b1a0871831adf2a54a5aa))
* **core:** give AnyEntity a structural definition ([e98a88a](https://github.com/JensPenneman/keelwerk/commit/e98a88a412dd1cbfd4aefb7275c26e91addc17bd))
* **core:** hand the runtime clock to the data adapters ([da5ab96](https://github.com/JensPenneman/keelwerk/commit/da5ab96124f3d2b4586c606bf3d6ca21285e702a))
* **core:** open the ledger file once ([81e6109](https://github.com/JensPenneman/keelwerk/commit/81e6109ee8790a588e28850ba5aca5e42787f730))
* **core:** refuse any string target on a conditional source ([7588e61](https://github.com/JensPenneman/keelwerk/commit/7588e613998ba1fe4086057e01797b99e6c75f56))
* **core:** shape command output under the caller's read plan ([b738fd5](https://github.com/JensPenneman/keelwerk/commit/b738fd5fba7a3f4443165a0a0b9139b56a4b6c54))
* **core:** take the session cookie's Max-Age from the runtime clock ([66fce70](https://github.com/JensPenneman/keelwerk/commit/66fce7001fc3002b1c1a459781e5e7dff381d4bb))
* **testing:** regenerate the fixture surfaces after the new core error code ([90ad5f3](https://github.com/JensPenneman/keelwerk/commit/90ad5f3a264f1294208883598a1230204ea5b402))


### Performance Improvements

* **core:** load ctx.all members in one query per entity ([704e397](https://github.com/JensPenneman/keelwerk/commit/704e397fe6c19fb45f8ac1813c76a7d661b73468))
* **core:** skip own fields in the app field checks ([634271d](https://github.com/JensPenneman/keelwerk/commit/634271d82d4f34c84c597aff56aa211005904158))


### Documentation

* add the brief for pennestack ([a6bf885](https://github.com/JensPenneman/keelwerk/commit/a6bf8853cd1d432440534e8cfba47f0616b7c08e))
* adopt FSL-1.1-ALv2 and record decisions 20, 25 and 83 to 87 ([b748655](https://github.com/JensPenneman/keelwerk/commit/b74865595142343d73a569cc50bd41facc20d87a))
* apply every decision of the register ([3f1bc8e](https://github.com/JensPenneman/keelwerk/commit/3f1bc8e8024c3540da7a478b1d10f1b1a950f695))
* apply the follow-ups of work packages 01 to 34 to the specification ([b794f67](https://github.com/JensPenneman/keelwerk/commit/b794f67e6c2246ed29727aca9765ee487e2fb362))
* architecture approved, ADRs accepted ([0bc3de2](https://github.com/JensPenneman/keelwerk/commit/0bc3de2ddb9f95c56cb940bd2e57ffa16e24daac))
* brief addendum 3 and the decision register ([1e64556](https://github.com/JensPenneman/keelwerk/commit/1e64556caabd6fd18bb29323d85ba1a2b5af54cf))
* close the m0 deliverables in the roadmap ([b9ab01f](https://github.com/JensPenneman/keelwerk/commit/b9ab01fbd8c1a9bbd055e1ccdb8fa7646ba36665))
* decisions 26 to 48 of 2026-10-27; beta policy; Trail first ([b46ff06](https://github.com/JensPenneman/keelwerk/commit/b46ff0600b7d6ca444d28604b3aa43253214e2d2))
* decisions 49 to 80 recorded; 50a confirmed ([b3be739](https://github.com/JensPenneman/keelwerk/commit/b3be73953d6dfdefaa3abd6e318a270eef1fba91))
* full architecture draft after critique and synthesis ([df59919](https://github.com/JensPenneman/keelwerk/commit/df5991945672a2d684370041c324ab3742b22bab))
* jobs, nodes and autoscaling design; encrypted personal data and queries ([07f0401](https://github.com/JensPenneman/keelwerk/commit/07f04010639707e3946986868841ee357836158f))
* kw_ prefix everywhere, the name is settled, decision 20 status wording ([865f9bb](https://github.com/JensPenneman/keelwerk/commit/865f9bb2d353d453e25fd2bbf3f2481f6b0b8195))
* licensing research and the decisions taken on 2026-10-26 ([9de8574](https://github.com/JensPenneman/keelwerk/commit/9de8574319167f22b1fa433a8964563c7ddac64c))
* mark decisions 144 and 160 as confirmed ([3338f08](https://github.com/JensPenneman/keelwerk/commit/3338f08edfb2b7935eaca59851636bab7b704707))
* merge jobs, nodes, autoscaling and encrypted queries; pure-handlers design ([60ed4d6](https://github.com/JensPenneman/keelwerk/commit/60ed4d66cf34f645424d27a939b552199b9efd01))
* merge the addendum 3 designs and apply the first decisions ([4821460](https://github.com/JensPenneman/keelwerk/commit/482146001b2242a2dc6d75b1eb6f0961935c19a3))
* merge the pure-handlers model as section 7.9 ([45035fb](https://github.com/JensPenneman/keelwerk/commit/45035fb8dc776bd33998dde9919dc7879fef0ef8))
* neutral wording for the review notes ([85470ca](https://github.com/JensPenneman/keelwerk/commit/85470ca804fe9ff8461cb3a514ffccb9eeb75f53))
* pass the logger its message before its fields in the sketch ([61bb731](https://github.com/JensPenneman/keelwerk/commit/61bb7318b50a601340c7b6389511ef412424fe23))
* record the decisions of 2026-11-10 and align the m2 scope ([c8ad21a](https://github.com/JensPenneman/keelwerk/commit/c8ad21a3e6571988c8640f17bab6fd6d3ab38425))
* record the m0 spike results and apply register k2 ([fd4af85](https://github.com/JensPenneman/keelwerk/commit/fd4af85b866c1cf2c08fddb3990683f7b2cc5740))
* record the node 26 re-checks ([e53af21](https://github.com/JensPenneman/keelwerk/commit/e53af21090fd004fdf824b9e7fd4b854f63ab108))
* register marks applied decisions and the editorial items ([e21e13c](https://github.com/JensPenneman/keelwerk/commit/e21e13cc31cca04a2593866c39d7703bc750742b))
* register section P and the M1 follow-ups of work packages 35 to 64 ([527948d](https://github.com/JensPenneman/keelwerk/commit/527948d8a68ca3f3a2fc7175b38b0f1d53358e19))
* research surveys and the core architecture draft ([339b95e](https://github.com/JensPenneman/keelwerk/commit/339b95e467fa9a5c1a57b07f19d051050090a53e))
* the guided tour (overview) and the quick fixes from its review ([69e4c0d](https://github.com/JensPenneman/keelwerk/commit/69e4c0d1b8c07261cb80c726e749afe1cd40405a))
* the project is named keelwerk ([bbdd41d](https://github.com/JensPenneman/keelwerk/commit/bbdd41d5e8908103adcb6cca634c5cbae8355940))
* write the m1 plan's gap decisions into the specification ([109f7a3](https://github.com/JensPenneman/keelwerk/commit/109f7a33290165e3b809f49df9d6e67d469ba647))
