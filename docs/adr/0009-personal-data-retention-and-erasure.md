# 9. Personal data, credential material, retention and erasure: crypto-shredding in the chain, scrubbed projections, operator-chosen retention, restores that never resurrect

Date: 2026-10-11 (revised after review the same day; amended 2026-10-25; note of 2026-10-28)

## Status

Accepted (2026-11-04). Decision 2's plaintext state tables, and the consequence about plaintext in backups of
state tables, are superseded by [ADR 0027](0027-encrypted-personal-data-and-queries.md) (decision 7b
of 2026-10-25). Item 7 follows decision 47c (2026-10-27): Launchway's modules suggest no rules, and
streams such as effect attempts and deployment logs keep their records unless a rule is adopted.

## Context

The brief requires that live data is never truly deleted and appended to a chain. Architecture.md
principle 8 makes erasure of personal data crypto-shredding of `.personal()` fields from the first
release, and defines "nothing deleted" as "nothing deleted without a retention rule the operator
chose"; the first draft left key custody, who may trigger erasure and the retention rules to the
data designer. Article 17 of the GDPR requires erasure without undue delay, with exceptions.

The research (events-and-sync.md) describes three techniques: crypto-shredding (Rails Event Store's
encryption mapper), which keeps events and hash chains intact but makes key custody critical;
redaction in place (KurrentDB's licensed tool, Loro's `redactJsonUpdates`), which rewrites bytes and
breaks hashes; and redaction events, which only hide data. The platform mapping asks for one key
hierarchy for secrets, personal data and blobs (gap G4), for blob keys that purges and erasure
destroy (G5), and for retention covering mail folders, previews, logs, delivery attempts and
acknowledged commands (G11).

Two tensions decide the design. Encrypting personal values everywhere would protect backups of state
tables too, but would forbid filtering, sorting, uniqueness and search on those fields. And an
append-only chain must stay verifiable while personal data becomes unreadable.

The review of 2026-10-11 found four more problems: hidden fields and sealed secrets entered the
immutable chain in plaintext, so a dump yielded every former password hash and every former secret
stayed decryptable; the mail store could not name its data subject, because subjects had to be a
field of the same row, and its extracted message text sat in plaintext in every event; restoring a
placement that shares a database cluster with the control store rewound the erasure ledger with the
data, and restores made by ordinary tools left epochs unchanged while positions and UIDs rewound;
and the key hierarchy had no keys for secrets that are not tenant data.

## Decision

1. **Data subjects.** An entity with `.personal()` fields declares `dataSubject`: `'id'` when the
   row is the subject's own record, a field holding the subject id, or a path through a required,
   immutable reference (`'accountId.ownerSubject'`), resolved at write time with the key id recorded
   per value. Rows whose data subject is erased become invisible tombstones, so their personal
   fields may be required. A field may name another subject of the same row with
   `.personal({ subject })`; such a field must be optional.
2. **Encryption in the chain.** Personal values in event payloads and before-images are encrypted with
   the subject's data key: AES-256-GCM, a random 96-bit nonce, associated data binding the namespace,
   stream, event and field. State tables hold plaintext, so queries keep working, and erasure scrubs
   them (superseded by ADR 0027: state columns are sealed too and queryable per declared
   capability).
3. **Credential material.** Values of `field.secret()` and `field.verifier()` are sealed with a value
   key of their own, in state rows and events alike; the kernel destroys a value's key when the value
   is replaced, the row archived or purged. Hidden fields are left out of before-images unless they
   opt in with a reason, and `.stateOnly()` fields (derived index inputs such as extracted message
   text) never enter events.
4. **Keys.** One key service: the deployment master key wraps a deployment key, backend keys and
   tenant keys, stored wrapped in the control store; these wrap the per-subject data keys and the
   per-value and per-blob keys in the namespace. Rotation by re-wrapping; data keys are never rotated
   in place because events are never re-encrypted. Retiring a tenant destroys its tenant key.
5. **Erasure.** `core.subjects.erase` is a command with its own rules (operator principals by
   default; modules may add self-service rules). It writes the erasure ledger in the control store
   and the deployment's ledger sinks first, shreds the subject's keys, appends an `erased` event to
   every stream that holds the subject's data (clearing personal fields, including `stateOnly` ones,
   and turning rows the subject owns into invisible tombstones), and purges the stream records of
   rows the subject owns. History reads show redaction markers where keys are gone.
6. **Backups and restore.** The ledger and the tombstones of destroyed keys live where a placement
   restore cannot rewind them: in the control store on its own database cluster and in append-only
   ledger sinks; `keelwerk doctor` warns when the control store and a placement share a cluster
   without a sink. At `connect` the kernel replays the ledger before a namespace serves traffic. It
   also compares each namespace's cluster identity (on PostgreSQL the system identifier and the
   timeline) and each scope's counters with high-water marks recorded outside the placement; a
   rewind bumps the scope's epoch and moves its counters past the marks, so tokens reset and
   positions and UIDs are never reused under an old epoch. The blob collector keeps bytes for at
   least the backup retention.
7. **Retention.** Rule kinds: compact history into a snapshot event, purge archived rows (leaving a
   purge tombstone), purge rows of `state` entities by condition, shallow CRDT history, and expiry
   of transient change records, receipts, sync clients and stream records. Rules are adopted by the
   operator per backend with per-tenant overrides, stored in the control store, and every run is
   recorded. Modules may suggest rules; suggestions have no effect until adopted, and Launchway's
   modules suggest none (decision 47c: everything is kept, and closed previews and superseded
   deployments reclaim only runtime artefacts). Only operational buffers have defaults (7 days for
   transient records, each action's idempotency window for receipts, 90 days for inactive sync
   clients); stream records, effect attempts included, are kept unless a rule is adopted. Rows still
   referenced by live rows are not purged; a purge removes blob keys in the same unit.
8. **Compaction** replaces old events of a stream with one snapshot event that keeps versions and
   positions and anchors the hash chain.
9. **Operator redaction** (rare, deployment scope, reason required) rewrites stored values that are
   not personal data but must go, records the original hash in a ledger, and accepts that the content
   of that event no longer verifies; inside CRDT history it uses Loro's redaction.
10. **Elsewhere.** Personal, secret, verifier and hidden values never enter logs, traces or decision
    logs; receipts of entity commands store references rather than rows; finished jobs keep only
    their outcome, without input, in `kw_job_history` for seven days (ADR 0025).

## Consequences

- The chain stays intact and verifiable after erasure: ciphertexts and hashes are unchanged, only keys
  disappear.
- A database dump yields no former password hash, token verifier or secret value: their keys are gone.
- Filters, sorting, uniqueness and search on personal fields keep working, at the price of plaintext
  in backups of state tables until they expire (a decision point for Jens). Superseded by ADR 0027:
  backups hold ciphertext, wrapped keys and index tags, and queries on personal fields use the
  capabilities each field declares.
- A dump of a placement alone cannot decrypt personal values in the chain; losing the master key, on
  the other hand, loses every personal value, secret and blob, so the master key needs its own
  backup and custody procedure.
- Required personal fields never hold fake values: an erased person's own rows disappear from reads,
  and other rows lose optional fields.
- No restore, whatever tool made it, brings back erased data or reuses positions under an old epoch;
  the home installation runs the control store in its own PostgreSQL instance to make that hold.
- Clients that synced data keep it until their next pull; free text that a module did not mark as
  personal is not covered; data already sent elsewhere is out of reach.
- Retention is explicit and audited: history only shrinks through rules the operator adopted.
