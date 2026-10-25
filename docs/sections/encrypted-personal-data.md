## Encrypted personal data and queries

Traceability: decision 7b of the register (decided 2026-10-25): personal fields are encrypted in
the state tables too, and searching, filtering, ordering, uniqueness and full-text search over them
are designed here. This part replaces the "In state tables" paragraph of
section 14.7.4 and is referenced from sections 6.2, 8.3 and 17.4.5;
[ADR 0027](adr/0027-encrypted-personal-data-and-queries.md) records it, and
[research/encrypted-queries.md](research/encrypted-queries.md) is the evidence.

A personal value is sealed wherever it is stored: in events and before-images (section 14.7.4,
unchanged), in its state column and in every derived index. The database holds ciphertext plus the
index tags the kernel computes for the capabilities a field declares. Handlers never see tags or
keys: queries return query descriptions (decision 50a), which the kernel and the adapters run.

### Threat model

Protected:

- A database dump, backup, stolen volume or replica without the deployment master key: no personal
  value can be read; it reveals the declared indexes' leakage (the matrix below), presence (a null
  column) and a 16-byte length bucket.
- Read access without process memory (a database administrator, a query injected through the SQL
  escape hatch, statement logs): the same plus the access pattern over time; statement parameters
  carry tags, never values.
- Write access: a sealed value cannot be forged or moved to another row or field (its associated
  data binds namespace, entity, row id, field and key id); an older value put back is found by
  comparing state with the chain.

Not protected:

- A compromised pennestack process (remote code execution, a memory dump, a malicious module): it
  holds unwrapped keys and can query and unseal as the kernel does.
- The operator: the master key decrypts everything.
- A backup together with the master key yields what that backup held, including subjects erased
  later; backup retention bounds this (section 14.7.6).
- Copies on clients, data sent elsewhere and free text nobody marked (section 14.7.8).

### Declaring capabilities

```ts
type PersonalQuery = 'eq' | 'prefix' | 'contains' | 'order' | 'search'
type Normalizer = 'exact' | 'nfc' | 'caseless' | 'email' | CustomNormalizer   // custom: a pure function with id and version

interface PersonalOptions<Q extends readonly PersonalQuery[]> {
  readonly subject?: string                    // another subject of the row (section 14.7.4)
  readonly queries?: Q                         // default []; .unique(), .index() and entity indexes imply 'eq'
  readonly normalize?: Normalizer              // default 'nfc' for string and text kinds, 'exact' otherwise
  readonly eq?: { readonly bits?: number }     // 8 to 32: truncated tags for low-entropy, non-unique fields
  readonly prefix?: { readonly min?: number; readonly max?: number }   // characters; defaults 3 and 32
  readonly contains?: { readonly bits?: number }                       // trigram tags; default 12 bits
  readonly order?: { readonly bytes?: number }                         // strings: ORE over the first bytes; default 16
  readonly keys?: 'tenant' | 'subject'         // key scope of the field's indexes; default 'tenant'
}

// In the field's type: hovering a field shows what its indexes reveal
interface PersonalFlags<Q extends readonly PersonalQuery[]> {
  readonly subject: string | null
  readonly queries: Q                          // effective, an implied 'eq' included
  readonly leaks: readonly ('presence' | 'length' | 'equality' | 'prefixes' | 'ngrams' | 'order' | 'tokens')[]
}
```

- Equality is always available: a personal field whose kind supports `eq` gets it by declaring it,
  and it is implied wherever the author already declared a lookup (`.unique()`, `.index()`, an
  entity index naming the field). A personal field without any of these supports `isNull` only.
- Uniqueness (`.unique()`, unique entity indexes, merge `exclusive`) needs the full 128-bit tag under
  a tenant key; `eq.bits` and `keys: 'subject'` are refused on such fields at `defineEntity`.
- Every other capability is opt-in, costs storage and writes and reveals what the matrix says;
  `pennestack doctor` reports both.
- `contains` requires a declared `maxLength` of at most 1,024 characters; longer text uses `search`.
- `search` admits the field to an entity's `searchIndexes` (without it, a compose error).
- `keys: 'subject'` derives the index keys from the data subject's key material, so two subjects'
  tags never match and erasure destroys the keys; each query on such an index must pin one
  subject (for mail, the `accountId` partition), else `unsupported`.

### Normalisation

The normaliser `N` defines equality for the field in both interpreters of the condition AST: the
compiled one compares tags of `N(value)`; the in-memory one compares `N(stored)` with `N(operand)`.
Every operator, uniqueness and search tokens use it; the stored value keeps its written form.

- `exact`: the kind's canonical encoding (decimal integers and decimals, RFC 3339 instants with
  milliseconds, strings as written).
- `nfc`, the default for strings: Unicode NFC, so a composed and a decomposed "é" are equal.
- `caseless`: NFKC, then locale-independent lower case.
- `email`: trimmed, NFC, the domain through `domainToASCII`, all lower case: `Jens@JensPenneman.com`
  and `jens@jenspenneman.com` are one value, also for the unique index.
- custom: changing its id or version rebuilds the field's indexes.

Normalisers follow the runtime's Unicode tables (17.0 on Node 24.21.0); each index records its
version, and `pennestack doctor` warns on a mismatch.

### The operator matrix

| Operator or need | Served by | Leaks (dump; query observer) | Otherwise |
|---|---|---|---|
| `eq`, `in` | blind index: HMAC-SHA-256 of `N(value)`, 128 bits, B-tree; exact | equality classes and sizes; repeated queries, result sets | `unsupported`, code `core.personal_operator`; in code, a type error first |
| `ne`, `nin` | the same tag, null-safe complement; full tags only | as `eq` | as above |
| uniqueness | a unique, partial index on the tag among non-archived rows | as `eq` | declaring `.unique()` declares it |
| `isNull` | the sealed column is `NULL` when absent | presence | always available |
| `startsWith` | prefix tags (64 bits) of `N(value)` for lengths `min` to `max`; a longer operand uses the `max` tag, then verification | the prefix tree with branch counts | `unsupported`; an operand shorter than `min`: `core.personal_needle_short` |
| `contains` on strings | trigram tags truncated to `bits`, all of the operand's required, then verification | bucketed trigram statistics per row | `unsupported`; operands under 3 characters: `core.personal_needle_short` |
| `contains` on personal sets and lists | element tags (`eq` on the element); exact | element equality classes | `unsupported` |
| `lt`, `lte`, `gt`, `gte`, sort, keyset pagination | ORE tokens (`order`): exact for numbers, decimals, instants and dates; strings by their first `bytes`, ties refined after unsealing; a cursor carries the token sealed, never the value | the total order of all values | `unsupported`; `page.sortable` refuses the field; a bounded scan sorts in memory |
| words of free text | the keyed token index (below) | per-row token sets; result sets | `unsupported` (JMAP: `unsupportedFilter`) |
| case-insensitive matching, Unicode normalisation | the normaliser, before every tag and in the in-memory interpreter | coarser classes only | code points after NFC |
| `some`, `none`, `every`, `is` | inner comparisons with exact capabilities only (`eq` family, `isNull`, prefix), because the database evaluates `EXISTS` | those of the inner capabilities | `unsupported` |
| `not`, negative positions | exact capabilities; approximate ones (truncated `eq`, `contains`, string ties of `order`, words) only in positive positions, where verification removes false matches | | `unsupported` |
| authorization rules (`where`, `check`), item checks; partial-index `where` | rules: exact capabilities only, and the shape stage re-checks every row in memory (section 8.4), so a tag collision cannot disclose a row; partial indexes: plaintext fields only | | compose error at `defineApp` |
| `count`, `total` | exact capabilities in the database; with verification, every candidate up to the scan limit | | `core.scan_limit` |
| `GROUP BY`, `DISTINCT` | by equality tag, labelled by unsealing one value per group (no aggregation API exists yet) | equality classes | `unsupported` |
| sums and averages of personal numbers | never in the database; a bounded scan in the kernel; minimum and maximum through `order` | | `unsupported` |
| joins on personal fields | not offered: per-field keys keep tags of different fields unlinkable; relations use ids | | not expressible |

Nothing falls back silently: what a field does not declare or a placement cannot serve fails closed.

### How a query runs

1. The kernel normalises the filter to the AST and conjoins the caller's plan (sections 8.3, 8.4).
2. The encryption planner checks each comparison on a personal field against its capabilities,
   normalises the operand, computes the tags and rewrites the comparison onto a derived index field
   of the entity descriptor (`binary` for equality tags, `tagSet` for prefix, trigram and token
   tags, `ore` for order tokens), marking approximate ones. The AST stays one AST; adapters compile
   the rewritten tree like any other.
3. The adapter runs it under the scope predicate (section 14.4.3).
4. The kernel unseals the rows' personal fields, re-evaluates the original condition in memory when
   anything was marked, and fills the page in sort order until it is full or ten times the page size
   has been examined; a shorter page then carries a cursor after the last examined row, so paging
   stays complete.
5. The shape stage masks and re-checks every row (section 8.4).

Live filters, item checks and offline ingestion evaluate on unsealed rows in memory (section 15.4.3)
and accept the same operators.

```ts
// accounts.profile.search: displayName is plaintext, email declares 'prefix'; a description, not rows (decision 50a)
handle: (input, ctx) => ctx.target.query({
  where: { or: [{ displayName: { contains: input.text } }, { email: { startsWith: input.text } }] },
  sort: [{ field: 'displayName', direction: 'asc' }],
})

// A bounded scan: one account's identities, sorted by a personal field without 'order'
handle: (input, ctx) => ctx.data.mailStore.identity.query({
  where: { accountId: input.accountId },
  sort: [{ field: 'name', direction: 'asc' }],
  scan: { limit: 200 },
})
```

A scan is the only way past a field's capabilities, and it is explicit: the indexable part of the
condition selects at most `limit` candidates (default 2,000, at most the adapter's `maxScan`), which
the kernel unseals, filters and sorts in memory. More candidates fail with `unsupported`, code
`core.scan_limit`, unless the description says `partial: true`; the result then carries
`complete: false` and a cursor to scan on. Generated actions never scan; custom queries opt in.

### Storage

On PostgreSQL (physical names from the adapter, section 14.4.2):

| Column | Type | Content | Index |
|---|---|---|---|
| `<field>` | `bytea`, nullable | format byte, key id (16), nonce (12), ciphertext of the value padded to 16 bytes, GCM tag (16): the binary form of the chain's `$pse` envelope | none |
| `<field>__eq` | `bytea` (16) | the blind index tag | B-tree; unique and partial for unique fields |
| `<field>__prefix` | `bigint[]` | prefix tags | GIN |
| `<field>__ngram` | `smallint[]` | trigram tags | GIN |
| `<field>__ore` | `ore` (M7) | the ORE token | B-tree through an operator class |
| `ps_search_<index>` | `bigint[]` | token tags of a search index | GIN |
| `ps_search_<index>_counts` | `bytea` | token counts, sealed with the subject's data key | none |

MySQL and SQLite keep equality tags in `BINARY(16)` or `BLOB` columns and multi-valued tags in one
index table per entity, `(tenant_id, row_id, slot, tag)`, with a B-tree on `(tenant_id, slot, tag)`.
State sealing is independent of the chain (associated data `namespace ‖ entity ‖ row id ‖ field ‖
key id`), because compaction rewrites event ciphertexts.

| Per personal value written | Work | Storage beside the row |
|---|---|---|
| sealing | one AES-256-GCM | the value rounded up to 16 bytes plus 45 bytes |
| `eq` | one HMAC | 16 bytes and a B-tree entry |
| `prefix` | up to 30 HMACs | 8 bytes per prefix and GIN entries |
| `contains` | one HMAC per distinct trigram | 2 bytes per trigram and GIN entries |
| `search` | one HMAC per distinct field and word form | 8 bytes per tag, GIN entries, the sealed counts |
| `order` | one ORE encryption (256 PRF calls per byte) | several hundred bytes |

An e-mail address with `eq` and `prefix` costs about 1 KB, mostly prefix GIN entries; a
filed message with 300 distinct word forms 5 to 10 KB on PostgreSQL and 20 to 30 KB in an index
table (estimates for M4 to measure).

### Keys and rotation

- Each tenant has an index root key per version, 256 random bits wrapped by the tenant key, in
  `ps_index_keys(scope_id, version, wrapped, created_at, retired_at)` in the namespace.
- Field keys come from HKDF-SHA-256 over the root key, salt `pennestack/index/1`, info `entity ‖
  field ‖ capability ‖ normaliser id and version ‖ parameters`: each capability has its own key, so
  the equality tag and the prefix tags of one value cannot be linked by value.
- `keys: 'subject'` uses a per-subject index key stored with the data keys (`ps_subject_keys`,
  purpose `index`) and shredded with them. Ciphertexts use the subject's data key, as in the chain;
  unwrapped keys share the 60-second cache of section 14.7.4.
- Rotation is reindexing: `pennestack keys rotate --index` adds a root key version and plans, per
  entity, shadow index columns (expand), a backfill job that unseals each row and writes new tags
  while writers write both, a read switch when the job completes and a contract step dropping the
  old tags, with uniqueness held on both (section 19.3). A changed normaliser, `bits`, prefix bound
  or language plans the same; `pennestack db reindex <entity> [--field <name>]` rebuilds on demand.
- Making a field personal later is a migration (add sealed and index columns, backfill, switch,
  drop the plaintext column, vacuum); older backups keep the plaintext until their retention passes.

### Erasure, restores and backups

Erasure (section 14.7.5) shreds the subject's data keys and subject index keys in step 2: from then
on no query matches the subject's subject-keyed tags, and its sealed values read as absent. In step 3
the `erased` event's evolve clears, in the same unit, each personal field of the subject: the sealed
column, its equality, prefix, trigram and ORE tags, its index-table rows and its tags and counts in
every search index; rows the subject owns become erased tombstones as before. A restore replays the
ledger and repeats steps 3 to 5, clearing restored index entries again. An old backup keeps what it
held (ciphertext, wrapped keys, tags), which only the master key opens; backup retention bounds it.

### Full-text search over personal text

A search index that contains a personal field is a keyed token index, maintained by the kernel and
stored in the adapter's tag sets, so it works on every adapter; the `search` capability of section
14.3.3 (`tsvector`, `fulltext`, `fts5`) remains for plaintext indexes.

- Tokens: words from `Intl.Segmenter`, NFKC, lower case, diacritics folded; address fields add the
  whole address, its local part and its domain. Each word yields its folded form and one stem per
  declared language (`@orama/stemmers` 3.1.18), tagged per field as `HMAC(key, field ‖ form)`
  truncated to 64 bits, under the subject's key unless the index declares `keys: 'tenant'`.
- Queries: every query word must match (any of its forms, in any requested field). The index answers
  neither phrases nor parts of words; a custom query may verify a phrase on unsealed text in a scan.
  Ranking by token counts (term frequency times inverse document frequency, from the sealed counts)
  serves custom queries for at most the scan limit's candidates.
- The index is derived and scrubbable: never in events, rebuilt from the chain and the blobs by
  `rederive` and `pennestack db reindex`, cleared by erasure, rebuilt by rotation.
- Known limit: whoever mails an account a word and later reads a dump learns that word's tag and
  every message of the account containing it; subject keys confine this to that account.

For the mail store (section 17.4):

| JMAP `Email/query` (RFC 8621) | Served by |
|---|---|
| `inMailbox`, `inMailboxOtherThan`, `before`, `after`, `minSize`, `maxSize`, `hasKeyword`, `notKeyword`, the thread-keyword conditions, `hasAttachment` | plaintext fields, unchanged |
| `text`, `from`, `to`, `cc`, `subject`, `body` | the token index, word semantics |
| `bcc`, `header` | `unsupportedFilter` |
| sort by `receivedAt`, `size`, `sentAt`, keyword sorts | plaintext, unchanged |
| sort by `from`, `to`, `subject` | `unsupportedSort` |

IMAP `SEARCH` maps alike: `FROM`, `TO`, `CC`, `SUBJECT`, `BODY` and `TEXT` become word matches
instead of RFC 9051's substring matches (documented); `HEADER Message-ID` uses the plaintext
`messageId`; other `HEADER` keys and `BCC` scan the selected mailbox up to the scan limit, else
`NO [LIMIT]`. `SearchSnippet/get` unseals the requested messages and marks the matched forms. The
`mail-store` configuration `search: 'full' | 'headers' | 'off'` sets what filing tokenises: headers and
bodies, header fields only, or nothing (search then stays with clients).

### Adapters

```ts
// Added to AdapterCapabilities (section 14.3.3)
readonly encryptedQueries: {
  readonly equality: boolean                     // tag columns with unique and partial indexes
  readonly tagSets: 'array' | 'table' | false    // prefix, trigram and token tags
  readonly order: 'ore' | false                  // ORE comparison in the database
  readonly maxScan: number                       // bound of a scan's limit
}
```

| Adapter | equality | tagSets | order | Milestone |
|---|---|---|---|---|
| PostgreSQL, PGlite | yes | `array` (GIN) | `ore` through an operator class (needs a superuser) | M1 equality, M3 prefix and trigrams, M4 tokens, M7 order |
| In-memory | yes | `table` (maps) | `ore` (the reference) | with each capability |
| MySQL 8.4, SQLite | yes | `table` | false | M7 |
| Supabase preset | yes | `array` | false (no operator class) | M7 |

A capability the placement's adapter lacks marks the namespace's backends `unavailable` at
`connect` (section 14.3.3). The in-memory adapter stores sealed values and tags as SQL adapters do,
so tests exercise the rewrite. The reference semantics are "unseal and evaluate": the conformance
kit's oracle unseals every row and evaluates the original condition with the core interpreter, and
the dual-evaluation suite requires each adapter's rewritten, verified result to equal the oracle's
for random rows, normalisers and operators (section 14.10).

### Types

`Row`, `Readable<R>`, `AsOf<R>` and `HistoryEntry<R>` are unchanged: a personal field keeps its
declared type. Only the operators a filter may use narrow:

```ts
type PersonalOps<T, Q extends PersonalQuery> =
  & { readonly isNull?: boolean }
  & ('eq' extends Q ? { readonly eq?: T; readonly ne?: T | null; readonly in?: readonly T[]; readonly nin?: readonly T[] } : {})
  & ('prefix' extends Q ? { readonly startsWith?: string } : {})
  & ('contains' extends Q ? { readonly contains?: string } : {})
  & ('order' extends Q ? { readonly lt?: T; readonly lte?: T; readonly gt?: T; readonly gte?: T } : {})
```

`Where<R>`, the wire `Filter` of section 16.4.4 and the GraphQL filter inputs use it for personal
fields; `page.sortable` accepts a personal field only with `order`, and a query description's `sort`
accepts one without it only beside `scan`. The SQL escape hatch types personal columns as `Sealed`,
hides index columns and refuses writes to both.

### `pennestack doctor`

The personal-data pass lists each personal field's capabilities, leaks, key scope and normaliser
and, on a running deployment, its index rows and bytes per tenant. It warns about equality indexes on
`boolean` and `enum` kinds or on fields with fewer than 1,000 distinct values in a tenant (sampled by
unsealing, with an `eq.bits` range from the rule `2 ≤ collisions < √P`), `prefix.min` below 3,
`contains.bits` above 12, every `order` field, search indexes with `keys: 'tenant'`, indexes built
under another Unicode version, failed reindex jobs, and backups still holding plaintext of fields
made personal later.

### Worked example: accounts and the mail store

```ts
// accounts.profile: registration looks the address up; the admin search types ahead
email: field.string({ format: 'email' }).unique().personal({ normalize: 'email', queries: ['prefix'] }).maskable(),

// auth.credential: the entity's unique index implies 'eq'
identifier: field.string({ format: 'email' }).optional().personal({ normalize: 'email' }),
//   indexes: [{ fields: ['identifier'], unique: true, where: { kind: 'password', revokedAt: { isNull: true } } }]

// mail-store.address: RCPT TO resolves by equality; the tag joins a composite unique index
localPart: field.string({ maxLength: 64 }).personal({ normalize: 'caseless' }),
//   indexes: [{ fields: ['localPart', 'domainId'], unique: true }]

// mail-store.email (section 17.4.13)
from: field.json(addressList).personal({ queries: ['search'] }),
to: field.json(addressList).personal({ queries: ['search'] }),
cc: field.json(addressList).optional().personal({ queries: ['search'] }),
subject: field.text().optional().personal({ queries: ['search'] }),
preview: field.string({ maxLength: 256 }).personal(),               // shown, never queried: no index
searchText: field.text().hidden().personal({ queries: ['search'] }).stateOnly(),
//   searchIndexes: [{ name: 'text', fields: ['subject', 'from', 'to', 'cc', 'searchText'], keys: 'subject', languages: ['nl', 'en'] }]
```

Unchanged: the plaintext fields (`receivedAt`, `size`, `mailboxIds`, `keywords`, `threadId`,
`messageId`), hence listings, threading, flags, quotas and positional paging. Changed: subject,
sender and body searches become word searches through the per-account token index, sorting by sender
or subject is refused, and `preview` and `mimeTree` are only shown. The api-sketch profile
search sends `'Je'`, below the prefix minimum of three: the action must require three characters, or
the field declares `prefix: { min: 2 }` and accepts a shallower prefix tree.
