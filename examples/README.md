# Offline demo

`demo.sh` copies [`tests/fixtures/mini-repo`](../tests/fixtures/mini-repo) into a throwaway
git repo under `fixture-repo/` (git-ignored, regenerated on every run), makes two real changes to
it, and runs the actual built CLI (`dist/cli.js`) against it. Nothing below is invented — this is
a real terminal transcript from `bash examples/demo.sh` on the built package.

```
$ npm run build && bash examples/demo.sh
== smart-test-select offline demo ==
(fresh copy of tests/fixtures/mini-repo, with its own throwaway git history)

--- Scenario 1: change src/a.ts, a file used by 5 of the 8 tests ---
5 of 8 tests affected:
  tests/a.test.ts -> src/a.ts
  tests/b.test.ts -> src/b.ts -> src/a.ts
  tests/barrel.test.ts -> src/barrel.ts -> src/a.ts
  tests/literalDynamic.test.ts -> src/literalDynamic.ts -> src/a.ts
  tests/typesOnly.test.ts -> src/a.ts

--- Scenario 2: also touch tsconfig.json -> safe mode, run everything ---
safe mode — running the full suite (8 tests)
  - tsconfig.json changed — running the full suite

Demo complete. The throwaway copy is at examples/fixture-repo/ (git-ignored, regenerated each run).
```

## What just happened

- **Scenario 1** changed one file, `src/a.ts`. The static import graph knows exactly which 5 of
  the 8 fixture tests can reach it — through a direct import, a barrel re-export
  (`src/barrel.ts`), a literal `import('./a.js')`, and a direct import from the test file itself
  (`tests/typesOnly.test.ts` imports both `src/a.ts` and `src/typesOnly.ts`, hence the short
  chain). The other 3 tests (alias consumer, non-literal dynamic import, and the untouched file)
  are correctly left out.
- **Scenario 2** additionally touched `tsconfig.json` — a file that changes how *every* test
  compiles and runs, not just what one file covers. `smart-test-select` refuses to narrow the run
  and says so explicitly instead of silently trusting a graph that no longer describes the build.

Re-run it yourself: `npm run build && bash examples/demo.sh`.
