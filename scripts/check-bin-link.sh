#!/usr/bin/env bash
# Proves a command the way a consumer meets it: installs every packed tarball of a directory into an
# empty scratch project and runs `keelwerk --version` through the bin link that npm creates, not with
# `node <file>`. Needs the network for the third-party dependencies, so the release workflow runs it
# (scripts/release.sh --dry-run and --publish), never the test suite.
#
# Usage: scripts/check-bin-link.sh <directory of tarballs>
set -euo pipefail

dir=${1:?usage: check-bin-link.sh <directory of tarballs>}
shopt -s nullglob
tarballs=("$dir"/*.tgz)
((${#tarballs[@]} > 0)) || { echo "no tarball in $dir" >&2; exit 1; }

scratch=$(mktemp -d "${TMPDIR:-/tmp}/keelwerk-bin-link.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
printf '{"name":"scratch","version":"1.0.0","private":true}\n' >"$scratch/package.json"
(cd "$scratch" && npm install --no-audit --no-fund --ignore-scripts "${tarballs[@]}" >/dev/null)

status=0
output=$("$scratch/node_modules/.bin/keelwerk" --version 2>&1) || status=$?
if ((status != 0)) || ! [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  echo "the keelwerk command does not run through its bin link (exit $status): $output" >&2
  exit 1
fi
echo "the keelwerk command runs through its bin link: $output"
