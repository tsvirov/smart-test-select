# Contributing

## Setup

```bash
npm ci
npm run build
npm test
npm run lint
```

## Project layout

- `src/graph.ts` — static import graph (ts-morph + the real TypeScript resolver)
- `src/select.ts` — reverse-reachability test selection
- `src/safemode.ts` — "run everything" triggers, always with an explicit reason
- `src/llm.ts` — the LLM fallback judge interface, `MockJudge`, `OpenAICompatJudge`
- `src/cli.ts` — the `sts` / `smart-test-select` CLI
- `tests/fixtures/mini-repo/` — the fixture project the golden tests and the offline demo run against
- `examples/demo.sh` — regenerates `examples/fixture-repo/` from the fixture and runs the offline demo

## Guidelines

- Any change to the selection logic must keep the core invariant true: when in doubt, prefer
  safe mode (run everything) over silently narrowing the test set. A false negative (a test
  that should have run but didn't) is the one bug this project cannot ship.
- New safe-mode triggers, graph edge cases, or LLM-fallback behavior need a test in the matching
  `tests/*.test.ts` file, ideally exercised against `tests/fixtures/mini-repo/`.
- Run `npm run build && npm test && npm run lint` before opening a PR — CI runs the same three
  commands on Node 20 and 22.
