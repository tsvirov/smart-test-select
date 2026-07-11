#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_SRC="$ROOT_DIR/tests/fixtures/mini-repo"
DEMO_DIR="$SCRIPT_DIR/fixture-repo"
CLI_JS="$ROOT_DIR/dist/cli.js"

if [ ! -f "$CLI_JS" ]; then
  echo "dist/cli.js not found — run 'npm run build' first." >&2
  exit 1
fi

echo "== smart-test-select offline demo =="
echo "(fresh copy of tests/fixtures/mini-repo, with its own throwaway git history)"

rm -rf "$DEMO_DIR"
cp -r "$FIXTURE_SRC" "$DEMO_DIR"

cd "$DEMO_DIR"
git init -q -b work
git config user.email "demo@example.com"
git config user.name "smart-test-select demo"
git add -A
git commit -q -m "baseline"
git branch main

echo
echo "--- Scenario 1: change src/a.ts, a file used by 5 of the 8 tests ---"
printf '\nexport const demoMarker = true;\n' >> src/a.ts
git add -A
git commit -q -m "change a.ts"
node "$CLI_JS" select --base main

echo
echo "--- Scenario 2: also touch tsconfig.json -> safe mode, run everything ---"
printf '\n' >> tsconfig.json
git add -A
git commit -q -m "touch tsconfig.json"
node "$CLI_JS" select --base main

echo
echo "Demo complete. The throwaway copy is at examples/fixture-repo/ (git-ignored, regenerated each run)."
