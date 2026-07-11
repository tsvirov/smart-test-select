import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph.js';
import { getChangedFiles, selectTests } from '../src/select.js';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-repo');
const TSCONFIG = path.join(FIXTURE_ROOT, 'tsconfig.json');

function abs(relPath: string): string {
  return path.join(FIXTURE_ROOT, relPath);
}
function rel(p: string): string {
  return path.relative(FIXTURE_ROOT, p).split(path.sep).join('/');
}

describe('selectTests', () => {
  it('selects every test transitively reachable through static edges, and nothing else', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = selectTests({ graph, changedFiles: [abs('src/a.ts')] });
    expect(result.selected.map(rel).sort()).toEqual(
      [
        'tests/a.test.ts',
        'tests/b.test.ts',
        'tests/barrel.test.ts',
        'tests/typesOnly.test.ts',
        'tests/literalDynamic.test.ts',
      ].sort(),
    );
  });

  it('gives every selected test a non-empty reason chain back to the changed file', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = selectTests({ graph, changedFiles: [abs('src/a.ts')] });
    const chain = result.reasons.get(abs('tests/b.test.ts'))!;
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.map(rel)).toEqual(['tests/b.test.ts', 'src/b.ts', 'src/a.ts']);
  });

  it('follows a tsconfig path alias edge to select only its consumer test', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = selectTests({ graph, changedFiles: [abs('src/utils/helper.ts')] });
    expect(result.selected.map(rel)).toEqual(['tests/aliasConsumer.test.ts']);
  });

  it('only selects a leaf file own direct test, proving it does not over-select', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = selectTests({ graph, changedFiles: [abs('src/untouched.ts')] });
    expect(result.selected.map(rel)).toEqual(['tests/untouched.test.ts']);
  });

  it('does NOT statically select a test reachable only through a non-literal dynamic import', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    // nonLiteralDynamic.ts itself changing selects its own direct test, but nothing beyond —
    // this is exactly the gap safe-mode / the LLM fallback exist to cover.
    const result = selectTests({ graph, changedFiles: [abs('src/nonLiteralDynamic.ts')] });
    expect(result.selected.map(rel)).toEqual(['tests/nonLiteralDynamic.test.ts']);
  });

  it('reports the total number of test files in the graph and an empty selection for an empty diff', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = selectTests({ graph, changedFiles: [] });
    expect(result.total).toBe(8);
    expect(result.selected).toEqual([]);
  });

  it('ignores a changed file that is not a node in the graph', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = selectTests({ graph, changedFiles: [abs('src/data.json')] });
    expect(result.selected).toEqual([]);
  });
});

describe('getChangedFiles', () => {
  it('uses the injected exec function and never shells out to a real git process', () => {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const fakeExec = (cmd: string, args: string[], cwd: string): string => {
      calls.push({ cmd, args, cwd });
      return 'src/a.ts\nsrc/b.ts\n\n';
    };
    const result = getChangedFiles('main', FIXTURE_ROOT, fakeExec);
    expect(result.map(rel)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(calls).toEqual([{ cmd: 'git', args: ['diff', '--name-only', 'main...HEAD'], cwd: FIXTURE_ROOT }]);
  });
});
