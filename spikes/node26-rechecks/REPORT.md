# Node 26 re-checks (WP-03)

Run on 2026-11-04: `node --version` prints `v26.13.0` (darwin arm64, Apple M2 Pro), pnpm 11.21.0.
Suite: `pnpm vitest run --project spike-node26-rechecks`, eight test files, each spawning `node` with `NODE_NO_WARNINGS` and `NODE_OPTIONS` removed from the child environment; `warning-control.test.ts` proves the child prints an emitted `ExperimentalWarning`.

| Check | Node 24.21.0 (Appendix B) | Node 26.13.0 (measured) |
|---|---|---|
| Linked workspace package, `--conditions=@keelwerk/source`, `.ts` source | runs | runs, empty stderr, exit 0 (a hand-made symlink, and the real pnpm link `packages/data/node_modules/@keelwerk/core`, which resolves to `packages/core/src/index.ts`) |
| Same package copied under `node_modules` | `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, exit non-zero |
| Without the condition the linked package resolves to `dist` and fails | not recorded | fails, not with the type-stripping error |
| `node:sqlite` open, prepare, `columns()` | SQLite 3.53.4, no warning | SQLite 3.54.0, no `ExperimentalWarning`, stderr empty; `columns()` names `id`, `name`; an INSERT has no columns; `StatementSync` has no `reader` key (the adapter shim stays) |
| `crypto.argon2` Argon2id, 19456 KiB, 2 passes, parallelism 1, 32-byte tag | about 14 ms, no warning | median 15.6, 17.0 and 16.7 ms over 21 runs per process (three runs of `pnpm vitest run --project spike-node26-rechecks src/argon2.test.ts` alone; the median is 15 to 18 ms when other test files run in parallel); stderr empty; deterministic for equal inputs |
| `process.versions.unicode` | 17.0 | 17.0 (unchanged: no reindex or `doctor` warning needed against Node 24 data) |
| NFC `e` + U+0301 | not recorded | U+00E9 |
| NFKC of U+FB01, U+2460, U+FF21, U+00B2 | not recorded | `fi`, `1`, `A`, `2` |
| `domainToASCII` | not recorded | `Bücher.example` -> `xn--bcher-kva.example`; `JensPenneman.com` -> `jenspenneman.com`; `例え.jp` -> `xn--r8jz45g.jp` |
| NFKC then lower case of U+1E9E, U+0130 (the `caseless` normaliser of 14.7.9.3) | not recorded | `ßi̇` (U+00DF, `i`, U+0307) |
| `email` normaliser sketch (trim, NFC, domain through `domainToASCII`, lower case) | not recorded | `Jens@JensPenneman.com` and ` jens@jenspenneman.com ` both give `jens@jenspenneman.com` |
| `Temporal.Instant` | not available (no global `Temporal`) | native (`typeof Temporal === 'object'`, no flag); `2026-11-04T10:20:30.123987654Z` rounded down to milliseconds is `2026-11-04T10:20:30.123Z`; epoch-millisecond round trip is equal |

Blocking: none. Type stripping behaves under pnpm links exactly as 13.4 states.

Text for the specification (line numbers of docs/architecture.md as of 2026-11-04):

- 13.2 and 13.4: "Checked again on Node 26.13.0 on 2026-11-04: a linked workspace package runs from its `.ts` source
  through `--conditions=@keelwerk/source`; the same package copied into `node_modules` fails with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; no type-stripping warning is printed."
- 13.2, Node row (line 3703): replace "26.12.1 of 2026-10-21" with "26.13.0, checked on 2026-11-04" if the lead wants the measured version.
- Appendix B (next to the Node 24.21.0 bullet at 13934): "Node 26.13.0: the same result; `node:sqlite` runs without an
  experimental warning (SQLite 3.54.0), `crypto.argon2` runs without a warning, `process.versions.unicode` is 17.0, and
  `Temporal.Instant` is native."
- 26.2 (13453-13454): replace "the Node 26 re-checks of decision 28a (former item 8); those remain open" with "the Node 26 re-checks of
  decision 28a (former item 8) were done on 2026-11-04 on Node 26.13.0 (spikes/node26-rechecks/REPORT.md) and passed".
- 14.3.7 (table cell at 4669): replace "checked again on Node 26 in M0" with "SQLite 3.54.0 in Node 26.13.0, no experimental warning;
  `StatementSync` still has no `reader`".
- 14.3.7: "`node:sqlite` on Node 26.13.0 (SQLite 3.54.0) runs without an experimental warning;
  `StatementSync` still has no `reader`."
- A.1 (`node:sqlite` row, 13610): replace "checked again on the Node 26 baseline in M0 (A.8)" with "checked again on Node 26.13.0 on 2026-11-04,
  SQLite 3.54.0, no experimental warning".
- A.4 (argon2 row, 13706): replace "checked again on Node 26 in M0 (A.8)" with "checked again on Node 26.13.0 on 2026-11-04, no warning".
- 14.7.9.3 and 26.3 (13484): "The Unicode version of Node 26.13.0 is 17.0, the same as on Node 24.21.0. NFKC followed by lower case of
  U+1E9E U+0130 gives `ßi̇` on both."
- 17.2.2 (and the 14 ms figures at 2346 and 9263): "`crypto.argon2` runs on Node 26.13.0 without a warning; Argon2id at 19 MiB, two passes, one lane
  takes a median of 16 ms on an Apple M2 Pro (15.6 to 17.0 ms over three runs of the argon2 test file alone; 15 to 18 ms with the other
  files running in parallel)." At 2346 and 9263 replace "14 ms" / "about 14 ms" with "about 16 ms".
- 6.4: "`Temporal.Instant` is native on Node 26.13.0 (not on Node 24.21.0). `instant.round({ smallestUnit: 'millisecond', roundingMode: 'floor' })`
  rounds down; the default `halfExpand` turns `.123987654` into `.124`."
