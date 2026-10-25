# 27. Encrypted personal data and queries: sealed state columns, declared capabilities

Date: 2026-10-25

## Status

Proposed. Decision 7b of the register (2026-10-25) is taken; the defaults below are open decision
points for Jens (architecture.md section 26.1). Amends ADR 0009, decision 2.

## Context

ADR 0009 encrypted personal values in the chain and kept state tables in plaintext, so that filters,
sorting, uniqueness and search keep working, at the price of plaintext in database dumps and old
backups. Jens chose 7b: encrypt the state tables too, and asked how searching, filtering, ordering,
uniqueness and full-text search, mail search included, can still work.

The research ([research/encrypted-queries.md](../research/encrypted-queries.md)) compared keys at
the database (pgsodium, Supabase Vault), no protection against the database server, with keys in the
application plus query tokens (CipherSweet, AWS Database Encryption SDK beacons, Acra, CipherStash,
MongoDB Queryable Encryption). Every token type leaks: equality classes, prefix trees, n-gram
statistics, order, word incidence; published attacks recover low-entropy columns, much of
order-revealed names and locations, and searched words through injected e-mail. No library fits.
Decision 50a makes queries return descriptions, so all encryption-aware steps live in the kernel and
the adapters.

## Decision

1. **Sealed state columns.** Personal values are sealed in state columns with AES-256-GCM under the
   subject's data key, padded to 16 bytes, with associated data binding namespace, entity, row id,
   field and key id; the column holds the binary form of the chain's `$pse` envelope.
2. **Declared capabilities.** `.personal({ subject?, queries?, normalize?, ... })` with `eq`,
   `prefix`, `contains`, `order` and `search`. Equality and uniqueness come from a 128-bit blind
   index and are implied by `.unique()`, `.index()` and entity indexes; every other capability is
   opt-in; a field without any supports `isNull` only. The field's type carries its capabilities and
   their leaks, and `Where<R>` offers only declared operators; row types are unchanged.
3. **Normalisers** (`nfc` by default, `caseless`, `email`, custom pure functions) define equality in
   both interpreters of the condition AST.
4. **Techniques.** HMAC-SHA-256 tags under per-field keys derived by HKDF from a tenant index root
   key; prefix tags (three characters at least); trigram tags truncated to 12 bits for fields of at
   most 1,024 characters; a keyed token index per data subject for words; ORE tokens on PostgreSQL in
   M7.
5. **One AST, verified results.** The kernel's encryption planner rewrites comparisons onto derived
   index fields that adapters compile like any field. Approximate comparisons stand only in positive
   positions of query filters and are verified on unsealed rows; authorization rules, relation
   quantifiers and negations use exact capabilities only.
6. **Fail closed.** Undeclared operators, short operands and exhausted scans fail with
   `unsupported` (`core.personal_operator`, `core.personal_needle_short`, `core.scan_limit`); the only
   fallback is an explicit, bounded scan in a custom query.
7. **Adapters** declare `encryptedQueries` (equality, tag sets, order, scan bound): PostgreSQL first,
   MySQL and SQLite in M7; an unsealing oracle is the dual-evaluation reference.
8. **Keys, rotation, erasure.** Rotating index keys or changing a normaliser is a reindex through
   expand, backfill and contract. Erasure shreds subject index keys with the data keys and clears
   every index entry of the subject in the unit of its `erased` event.
9. **Mail.** Search over personal header fields and bodies uses the per-account token index with
   word semantics; JMAP answers `unsupportedFilter` and `unsupportedSort` for what it cannot serve,
   IMAP `SEARCH` matches words instead of substrings.

## Consequences

- A dump or backup without the master key yields no personal value, only the declared indexes'
  leakage, presence and length buckets; with the master key, or from a compromised process, everything
  stays readable.
- Queries that worked on plaintext can become type errors (`startsWith` on an address without
  `prefix`); IMAP substring search becomes word search; mail cannot be sorted by sender or subject.
- Every personal write costs one encryption and one HMAC per tag; indexes grow (5 to 10 KB per
  message on PostgreSQL, to be measured in M4).
- Low-entropy personal fields gain little from equality indexes, and `pennestack doctor` says so.
- The mail token index reveals word presence to someone who can both mail the account and read a
  dump; per-account keys confine it to that account.
- Capability, normaliser and key changes are reindexes; mail search no longer needs `tsvector` or
  `fts5` and works on every adapter.
