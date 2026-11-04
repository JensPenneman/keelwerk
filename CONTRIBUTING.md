# Contributing to keelwerk

keelwerk is pre-1.0 and in beta. The specification is [docs/architecture.md](docs/architecture.md);
the decisions are in [docs/decisions.md](docs/decisions.md) and the
[architecture decision records](docs/adr/), the milestones in [docs/roadmap.md](docs/roadmap.md).

## Outside contributions

Outside contributions (pull requests) are not accepted until a contributor licence agreement exists
(decision 85a). Issues and discussions are welcome. Security problems go to
[SECURITY.md](SECURITY.md), never to a public issue.

## Licence

keelwerk is licensed under FSL-1.1-ALv2, the Functional Source License, Version 1.1, with the
Apache-2.0 future licence: see [LICENSE.md](LICENSE.md). Licensor: Jens Penneman.

## Development setup

You need the current Node.js LTS (`.nvmrc` holds `lts/*`; `engines.node` is `>=26`) and pnpm 11.21.0.

```sh
npm install -g pnpm@11.21.0   # pnpm then follows packageManager in package.json
pnpm install       # installs dependencies and the Git hooks
pnpm check         # biome ci, knip, tsc -b, vitest run
```

| Command | What it does |
|---|---|
| `pnpm build` | `tsc -b`: type-check and build every project |
| `pnpm lint` | Biome lint and format check |
| `pnpm format` | Apply Biome's formatting |
| `pnpm test` | Unit and type tests (Vitest with type checking) |
| `pnpm knip` | Report unused files, exports and dependencies |
| `pnpm check` | All of the above as CI runs them; run it before you push |

## Signed commits

Every commit on `main` is signed with the author's GPG key, and the repository requires it. Set
`commit.gpgsign` and `user.signingkey`, and check with `git log --show-signature -1`. Unsigned
commits are rejected.

## Commit messages

Commits and pull request titles follow
[Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <summary>
```

- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.
- Scopes are advisory: `core`, `data`, `testing`, `biome-config`, `deps`, `ci`, `docs`. commitlint
  warns about other scopes and does not reject them.
- Mark a breaking change with `!` after the type or scope and a `BREAKING CHANGE:` footer.

`feat` and `fix` commits and breaking changes determine the next version; before 1.0 a breaking
change raises the minor version.

## The single-purpose file rule

Every file defines one thing and is named after it, in kebab-case: `add-minutes.ts` exports
`addMinutes` (decision 58a, architecture section 23). Consequences the lint preset enforces:

- no barrel files, no `export *`, no `import * as`, no default exports (tool configuration files
  excepted), no enums, namespaces or parameter properties;
- a library package has one curated entry, `src/index.ts`, of named re-exports;
- exports come last in a file; relative imports carry the `.ts` extension; a file is a warning
  from 300 lines on;
- no import-time side effects (enforced by the planned `no-import-effects` plugin, not yet shipped).

## Git hooks

`pnpm install` installs the hooks with lefthook:

| Hook | Runs |
|---|---|
| `pre-commit` | Biome on the staged files; its fixes are staged again |
| `commit-msg` | commitlint |
| `pre-push` | `tsc -b`, then the tests |

`LEFTHOOK=0` skips the hooks for one command. CI runs the same checks.

## Releases

release-please keeps a release pull request open on `main`. Because every commit on `main` is
signed, that pull request is not merged on GitHub: the maintainer runs `scripts/release.sh`, which
cherry-picks the release commit onto `main`, signs it and the tag, pushes both and publishes the
GitHub release. For CI to run on the release pull request, store a token with contents and pull
requests write access in the `RELEASE_PLEASE_TOKEN` secret.
