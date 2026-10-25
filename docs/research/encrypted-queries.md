# Research: queries over encrypted personal data

Date: 2026-10-25. Author: the encrypted-queries designer. Question: decision 7b of the register
(2026-10-25) encrypts fields marked `.personal()` in the state tables as well as in the event chain;
Jens asked how searching, filtering, ordering, uniqueness and full-text search, mail search
included, can work on such data. Method: 8 web searches and 6 page fetches (both caps reached),
versions checked with `npm view` on 2026-10-25, Node.js built-ins tried on Node 24.21.0 (Unicode
17.0, ICU 78.3). Papers and statements marked "not re-checked" are cited as known before this round.

## 1. Two trust models

- **Keys at the database.** pgsodium's transparent column encryption and Supabase Vault keep a root
  key outside the dump but load it into the database server. A stolen dump is safe; whoever controls
  the server can decrypt, and queries run over plaintext inside the database. Supabase lists pgsodium
  as "pending deprecation" and no longer recommends its server key management and transparent column
  encryption; Vault is a separate extension using the same per-project root key (documentation read
  2026-10-25).
- **Keys in the application.** Only the application holds keys. The database stores ciphertext plus
  tokens the application computes (blind indexes, beacons, terms) and answers queries over them; what
  the tokens reveal is the scheme's leakage. CipherSweet, the AWS Database Encryption SDK, Acra,
  CipherStash and MongoDB Queryable Encryption work this way.

Architecture.md section 14.7.4 keeps the master key outside the database and wraps per-subject data
keys under tenant keys, so decision 7b belongs to the second model: the kernel seals, computes tokens
and unseals; adapters store and compare tokens.

## 2. Prior art

| System (checked) | Keys | Equality, uniqueness | Prefix, substring | Order | Lesson for pennestack |
|---|---|---|---|---|---|
| CipherStash EQL with `@cipherstash/stack` 1.2.1 (MIT, 2026-10-02; native core `@cipherstash/protect-ffi` 0.33.0; the earlier `@cipherstash/protect` 12.0.1 of 2026-08-18) | split between a hosted key service whose source is not published and a client key | HMAC-SHA-256 terms with `UNIQUE`, `GROUP BY` and hash indexes; data sealed with AES-256-GCM-SIV | "match": a Bloom filter over trigrams with a GIN index, probabilistic, also the free-text index | a directly sortable order-preserving term ("CLLW") by default, block ORE (`ore_block_u64_8_256`) as an alternative whose operator class needs a superuser, so Supabase gets no range index | the closest design, plain SQL on PostgreSQL; the key service rules the library out; its benchmark: exact lookups 0.1 ms, Bloom matches 0.4 ms at 10,000 rows and 144 ms at 10 million; it advises no index at all when order or frequency is sensitive |
| CipherSweet (PHP first; `ciphersweet-js` 2.0.6, ISC, last published 2022-09-28) | local; one key per index through HKDF | truncated keyed hashes "used as a Bloom filter" (false positives, never false negatives); "fast" indexes use keyed BLAKE2b or HMAC-SHA384, "slow" ones Argon2id or PBKDF2-SHA384 | transforms (lower case, first character, last four digits) as extra indexes; compound indexes over several fields | none | planning rule: between 2 and √P coincidences for P distinct values; compound indexes hide booleans; several indexes on one field invite "crossword puzzle attacks"; no `LIKE`, regular expressions or inequalities |
| AWS Database Encryption SDK, beacons (guide read 2026-10-25) | client-side | standard beacons: HMAC over the value and a partition id, truncated | virtual fields (prefix, suffix, lower case, segments); compound beacons | none | starting length `b = log2(p) − 1`, range `2 ≤ collisions < √p` (8 to 15 bits for 100,000 values); length fixed after the first write; correlated fields need shorter beacons; skewed data such as a rare-disease test result cannot be protected; hot values spread over random partitions |
| MongoDB Queryable Encryption (`mongodb-client-encryption` 7.2.1, Apache-2.0) | client-side | equality, generally available since 7.0 (2023, not re-checked) | prefix, suffix and substring previewed in 8.2 (2025-09-25), announced as generally available in the week before MongoDB's post of 2026-10-06; substring only for fields of at most 50 characters and terms of 2 to 6 characters | range, generally available since 8.0 (2024, not re-checked) | structured encryption: randomised ciphertexts plus server-side metadata, so a dump shows no equal tokens; the protocol lives inside the MongoDB server; substring indexes are bounded to short fields; the announcement says nothing on access-pattern leakage |
| Acra Community Edition (Apache-2.0, 0.96.0 of 2024-09-09) | proxy or client | HMAC-SHA-256 blind index beside AES-GCM ciphertext, exact queries | prefix and suffix only in the top commercial tier | none | ePrint 2019/806 groups the leakage as index metadata, search pattern and access pattern; a proxy that rewrites SQL conflicts with planning in the kernel |
| pgsodium, Supabase Vault | at the database server | plaintext inside the database | plaintext | plaintext | another trust model: no protection against the database server |
| Proton Mail (engineering note, 2022-08-31) | the user's device | | full text by scan | | a forward index: each message decrypted on the device, re-encrypted with AES-GCM into IndexedDB, scanned per query (no inverted index; exact phrases work); a plaintext cache in memory during the session; Proton judged a scan fast enough for typical mailboxes |
| Tuta (blog, 2017-12-21) | the user's device | | full text | | an encrypted index built and searched on the device; the server never sees searches |
| Stalwart (documentation updated 2026-10-03) | the user's OpenPGP key or S/MIME certificate | | full text: built-in engine or an external one | | incoming mail is encrypted with the user's public key before it is written (`encryptAtRest`, on once a key is registered; `encryptOnAppend` off by default); the server cannot read those bodies afterwards; the documentation does not say what the full-text index holds for them |

## 3. Techniques and their leakage

| Technique | Serves | A dump shows | A query observer also learns | Known attacks |
|---|---|---|---|---|
| Randomised AEAD (AES-256-GCM, random nonce) | storage | presence, length (a bucket when padded) | rows returned | none beyond length |
| Blind index: HMAC of the normalised value, 128 bits | `eq`, `in`, uniqueness, grouping | equality classes and their sizes | repeated queries, result sets | frequency analysis, decisive on low-entropy columns |
| Truncated blind index (beacon) | `eq` with false positives | blurred classes | as above | weaker, fails on skewed data |
| Prefix tags, one per prefix length | `startsWith` | the prefix tree with branch counts | as above | letter frequencies at shallow depths |
| n-gram tags truncated to few bits | `contains` | bucketed n-gram sets per row | as above | n-gram frequency and co-occurrence analysis |
| Keyed token index per subject | words | each subject's word-incidence matrix | which documents match each query | count and injection attacks (section 4) |
| Order-preserving encryption | range, sort by byte order | order and about the upper half of the plaintext bits (not re-checked) | | sorting attacks |
| Order-revealing encryption | range, sort by a comparison function | total order once stored values are compared, plus the first differing block or bit | | attacks of section 4 |
| Structured encryption (MongoDB) | equality, range, substring | sizes of data and metadata | access and volume patterns | volume and access-pattern attacks |
| Bounded unseal-and-scan in the application | anything | nothing new | the candidate set | none beyond it |

## 4. Leakage-abuse results (not re-checked in this round)

- Islam, Kuzu and Kantarcioglu (NDSS 2012): access patterns plus known word co-occurrence identify
  many queried keywords.
- Cash, Grubbs, Perry and Ristenpart (ACM CCS 2015): with some known documents, the count attack
  recovers queries and document contents from the leakage of practical schemes.
- Naveed, Kamara and Wright (ACM CCS 2015): frequency analysis and sorting attacks on deterministic
  and order-preserving encryption recovered most values of columns such as sex, race, age and
  mortality risk in real hospital records.
- Zhang, Katz and Papamanthou (USENIX Security 2016): whoever can send the victim e-mail injects
  chosen words and learns what the victim searches. For a server-side token index this holds at rest
  too: mail a word, later read a dump, and that word's token and every message containing it are
  known.
- Boldyreva, Chenette, Lee and O'Neill (EUROCRYPT 2009) defined order-preserving symmetric
  encryption; the 2011 follow-up by Boldyreva, Chenette and O'Neill showed it reveals roughly the
  upper half of the bits.
- Chenette, Lewi, Weis and Wu (FSE 2016) and Lewi and Wu (ACM CCS 2016) built order-revealing
  encryption with less leakage; Lewi and Wu's stored right ciphertexts reveal nothing until compared
  with a query's left ciphertext, but sorting stored values needs both halves.
- Durak, DuBuisson and Cash (ACM CCS 2016) and Grubbs, Sekniqi, Bindschaedler, Naveed and Ristenpart
  (IEEE S&P 2017): even limited-leakage ORE lets an attacker with auxiliary data recover much of
  names, ZIP codes and locations.
- Curtmola, Garay, Kamara and Ostrovsky (ACM CCS 2006) defined leakage for searchable symmetric
  encryption; Fuller et al. (IEEE S&P 2017, arXiv 1703.02014) survey the field.

Consequences: equality tags suit high-entropy values (e-mail addresses, phone numbers) and harm
low-entropy ones (booleans, enums, birth years); order and n-gram tags approach plaintext on natural
data; for mail, injection makes any deterministic server-side token index reveal word presence to
someone who can both send mail and read a dump.

## 5. Mail search

1. **Server-side keyed token index.** Words of the indexed fields are normalised (NFKC, lower case,
   folded diacritics), stemmed and tagged with HMAC under a key of the mailbox owner; the database
   holds a tag set per message (PostgreSQL: `bigint[]` with GIN; MySQL and SQLite: an index table).
   All query words must match; no phrases, no parts of words; ranking from token counts sealed per
   message. Works on every adapter and for every protocol. Leaks the word-incidence matrix per account
   and, under injection, word presence.
2. **Unseal and scan.** The kernel unseals candidates bounded by plaintext conditions (a mailbox, a
   date range) and matches in memory, with exact substring semantics. Good for thousands of messages,
   wrong as the only path for large mailboxes.
3. **Client-side index** (Proton, Tuta). Nothing reaches the server, but it needs pennestack's own
   client; Thunderbird, Apple Mail and iOS Mail search through IMAP `SEARCH` or JMAP `Email/query`.

Protocol fit (RFC 8621 section 4.4.1): `inMailbox`, `inMailboxOtherThan`, `before`, `after`,
`minSize`, `maxSize`, the keyword and thread-keyword conditions and `hasAttachment` use plaintext
fields; `text`, `from`, `to`, `cc`, `subject` and `body` map to the token index; `bcc` and `header`
have no index (`unsupportedFilter`); sorting by `from`, `to` or `subject` gets `unsupportedSort`,
which JMAP defines for this case. IMAP (RFC 9051) defines string search keys as substring matches;
a token index answers words, so `SEARCH BODY` and `TEXT` become word matches, a documented deviation
(how other IMAP servers with full-text indexes handle it was not researched).

Estimated size for 300 distinct tags per message: 5 to 10 KB per message on PostgreSQL (array, GIN
entries and posting lists, sealed counts) and 20 to 30 KB in an index table on MySQL and SQLite; M4
measures it.

## 6. Recommendation

1. Seal personal values in state columns with AES-256-GCM under the subject's data key, as the chain
   does, padded to 16-byte buckets.
2. Equality and uniqueness through a 128-bit blind index of the normalised value, keyed per tenant
   and field, wherever the author declares a lookup.
3. Everything else opt-in per field, each with its leak stated: prefix tags (at least three
   characters), trigram tags truncated to 12 bits for fields of at most 1,024 characters, a
   per-subject keyed token index for words, and ORE only later, on PostgreSQL.
4. Verify every approximate match on unsealed rows, so results stay exact; an undeclared operator
   fails with `unsupported`, never a wider filter.
5. An explicit, bounded unseal-and-scan for small sets and for sorting small lists.
6. Mail: option 1 with per-account keys, scans for what it cannot answer, client-side search later.
7. No library: CipherStash needs its key service, `ciphersweet-js` is stale, MongoDB's protocol needs
   its server; `node:crypto` has AES-256-GCM, HMAC-SHA-256 and HKDF. Stemming: `@orama/stemmers`
   3.1.18 (Apache-2.0, no dependencies, 28 languages including Dutch and English); `snowball-stemmers`
   0.6.0 (2022-06-26) and `stemmer` 2.0.1 (2022-11-02, English) are older.

## 7. Not verified

- What Stalwart's full-text index holds for messages it encrypted at rest.
- The MongoDB server version that made substring queries generally available.
- Whether the migration role of a self-hosted PostgreSQL can install an ORE operator class
  (CipherStash reports a superuser is needed).
- Index sizes and query times; all figures above are estimates.

## Sources

- CipherStash: https://github.com/cipherstash/encrypt-query-language,
  https://cipherstash.com/docs/reference/eql/v2/indexes, https://cipherstash.com/docs/security/cryptography,
  https://github.com/cipherstash/benches (read 2026-10-25)
- CipherSweet: https://ciphersweet.paragonie.com/security, https://ciphersweet.paragonie.com/php/usage,
  https://paragonie.com/blog/2019/01/ciphersweet-searchable-encryption-doesn-t-have-be-bitter (2019-01)
- AWS Database Encryption SDK:
  https://docs.aws.amazon.com/database-encryption-sdk/latest/devguide/choosing-beacon-length.html,
  https://docs.aws.amazon.com/database-encryption-sdk/latest/devguide/beacons.html (read 2026-10-25)
- MongoDB: https://www.mongodb.com/company/blog/product-release-announcements/queryable-encryption-prefix-suffix-substring-queries-are-now-ga
  (2026-10-06), https://www.mongodb.com/docs/upcoming/core/queryable-encryption/fundamentals/encrypt-and-query/
  (read 2026-10-25), MongoDB's preview announcement of 2025-09-25
- Acra: https://docs.cossacklabs.com/acra/acra-in-depth/cryptography-and-key-management/,
  https://github.com/cossacklabs/acra/releases, https://eprint.iacr.org/2019/806 (2019)
- pgsodium and Vault: https://supabase.com/docs/guides/database/extensions/pgsodium (read 2026-10-25),
  https://github.com/orgs/supabase/discussions/27109 (2024-06)
- Proton: https://proton.me/blog/engineering-message-content-search (2022-08-31)
- Tuta: https://tuta.com/blog/first-search-encrypted-data (2017-12-21)
- Stalwart: https://stalw.art/docs/encryption/overview (updated 2026-10-03), https://github.com/stalwartlabs/stalwart
- Papers of section 4 (not re-checked); RFC 8621 (JMAP for Mail); RFC 9051 (IMAP4rev2)
- npm registry (`npm view`, 2026-10-25): every package version named above
