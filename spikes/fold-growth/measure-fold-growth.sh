#!/usr/bin/env bash
# Measures the type instantiations of `defineApp` (the two benchmarks of
# packages/type-budgets/src/compose-app.bench.ts) at several commits of the core package.
#
#   bash spikes/fold-growth/measure-fold-growth.sh [--variant <variant>] [<commit> ...]
#
# Variants (applied to model/app-checks.ts of each scratch tree): as-is (default),
# no-conflicting-fields, no-dangling-refs, no-field-checks, cut (the working-tree file).
# Without commits: dcc5057, the commits that changed the core module or the model up to 6e88cc4,
# then 6e88cc4 and HEAD. Prints one markdown table; exits 1 when any row fails.
# Every commit is unpacked with `git archive` into a scratch directory outside the repository;
# nothing is written inside the worktree. Only packages/core comes from the commit; the benchmark
# file and TypeScript are the worktree's.
set -euo pipefail

WT=$(git rev-parse --show-toplevel)
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

INDEX=0
VARIANT=as-is
if [ "${1:-}" = "--variant" ]; then
  VARIANT=${2:?variant missing}
  shift 2
fi
case "$VARIANT" in
  as-is | no-conflicting-fields | no-dangling-refs | no-field-checks | cut) ;;
  *) echo "unknown variant: $VARIANT" >&2; exit 1 ;;
esac

if [ "$#" -gt 0 ]; then
  COMMITS=("$@")
else
  COMMITS=(dcc5057)
  while IFS= read -r sha; do
    COMMITS+=("$sha")
  done < <(git -C "$WT" log --reverse --format=%h dcc5057..6e88cc4 -- packages/core/src/core-module packages/core/src/model)
  COMMITS+=(6e88cc4 HEAD)
fi

ATTEST=$(realpath "$WT/packages/type-budgets/node_modules/@ark/attest")
TS=$(realpath "$WT/packages/type-budgets/node_modules/typescript")

apply_variant() {
  local file=$1
  case "$VARIANT" in
    as-is) ;;
    cut) cp "$WT/packages/core/src/model/app-checks.ts" "$file" ;;
    *)
      node -e '
        const fs = require("node:fs");
        const [file, variant] = process.argv.slice(1);
        let text = fs.readFileSync(file, "utf8");
        const swaps = {
          "no-conflicting-fields": [["Check<ConflictingFields<WithCore<Ms>>", "Check<never"]],
          "no-dangling-refs": [["Check<DanglingRefs<WithCore<Ms>>", "Check<never"]],
          "no-field-checks": [
            ["Check<ConflictingFields<WithCore<Ms>>", "Check<never"],
            ["Check<DanglingRefs<WithCore<Ms>>", "Check<never"],
          ],
        }[variant];
        for (const [from, to] of swaps) {
          if (!text.includes(from)) {
            console.error("text not found in app-checks.ts: " + from);
            process.exit(1);
          }
          text = text.replace(from, to);
        }
        fs.writeFileSync(file, text);
      ' "$file" "$VARIANT"
      ;;
  esac
}

measure() {
  local ref=$1 sha S out
  sha=$(git -C "$WT" rev-parse --short "$ref") || return 1
  S=$SCRATCH/$((++INDEX))-$sha
  mkdir -p "$S" || return 1
  git -C "$WT" archive "$sha" tsconfig.base.json packages/core/src packages/core/package.json packages/core/tsconfig.json | tar -x -C "$S" || return 1
  ln -s "$WT/node_modules" "$S/node_modules" || return 1
  ln -s "$WT/packages/core/node_modules" "$S/packages/core/node_modules" || return 1
  mkdir -p "$S/packages/type-budgets/src" "$S/packages/type-budgets/node_modules/@keelwerk" "$S/packages/type-budgets/node_modules/@ark" || return 1
  ln -s ../../../core "$S/packages/type-budgets/node_modules/@keelwerk/core" || return 1
  ln -s "$ATTEST" "$S/packages/type-budgets/node_modules/@ark/attest" || return 1
  ln -s "$TS" "$S/packages/type-budgets/node_modules/typescript" || return 1
  cp "$WT/packages/type-budgets/src/compose-app.bench.ts" "$S/packages/type-budgets/src/" || return 1
  cp "$WT/packages/type-budgets/package.json" "$S/packages/type-budgets/" || return 1
  cat > "$S/packages/type-budgets/tsconfig.json" <<'JSON' || return 1
{"extends":"../../tsconfig.base.json","compilerOptions":{"rootDir":"src","noEmit":true},"include":["src"]}
JSON
  apply_variant "$S/packages/core/src/model/app-checks.ts" || return 1
  out=$S.out
  if ! (cd "$S/packages/type-budgets" && node --conditions=@keelwerk/source src/compose-app.bench.ts --shouldFormat false --benchErrorOnThresholdExceeded false >"$out" 2>&1); then
    echo "bench failed at $sha" >&2
    tail -n 20 "$out" >&2
    return 1
  fi
  local counts
  counts=$(grep -oE 'Result: [0-9]+ instantiations' "$out" | grep -oE '[0-9]+' || true)
  if [ "$(printf '%s\n' "$counts" | grep -c .)" -ne 2 ]; then
    echo "no two Result lines at $sha" >&2
    return 1
  fi
  R3=$(printf '%s\n' "$counts" | sed -n 1p) || return 1
  R25=$(printf '%s\n' "$counts" | sed -n 2p) || return 1
  DATE=$(git -C "$WT" log -1 --format=%cs "$sha") || return 1
  SUBJECT=$(git -C "$WT" log -1 --format=%s "$sha" | cut -c1-60) || return 1
  SHA=$sha
}

echo "| commit | date | subject | 3 modules | 25 modules | step 3 | step 25 |"
echo "|---|---|---|---|---|---|---|"
STATUS=0
PREV3=""
PREV25=""
for c in "${COMMITS[@]}"; do
  if measure "$c"; then
    if [ -n "$PREV3" ]; then
      STEP3=$((R3 - PREV3))
      STEP25=$((R25 - PREV25))
    else
      STEP3=""
      STEP25=""
    fi
    echo "| $SHA | $DATE | ${SUBJECT//|/\\|} | $R3 | $R25 | $STEP3 | $STEP25 |"
    PREV3=$R3
    PREV25=$R25
  else
    echo "| $c | | measurement failed | | | | |"
    STATUS=1
  fi
done
exit $STATUS
