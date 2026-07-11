import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph.js';
import { checkSafeMode } from '../src/safemode.js';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-repo');
const TSCONFIG = path.join(FIXTURE_ROOT, 'tsconfig.json');

function abs(relPath: string): string {
  return path.join(FIXTURE_ROOT, relPath);
}

describe('checkSafeMode', () => {
  it('triggers on package.json', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = checkSafeMode({
      graph,
      rootDir: FIXTURE_ROOT,
      changedFiles: [abs('package.json')],
      llmEnabled: false,
    });
    expect(result.triggered).toBe(true);
    expect(result.reasons[0].trigger).toBe('config-changed');
  });

  it('triggers on tsconfig.json', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = checkSafeMode({
      graph,
      rootDir: FIXTURE_ROOT,
      changedFiles: [abs('tsconfig.json')],
      llmEnabled: false,
    });
    expect(result.triggered).toBe(true);
    expect(result.reasons[0].trigger).toBe('config-changed');
  });

  it('triggers on a CI workflow file under .github/', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = checkSafeMode({
      graph,
      rootDir: FIXTURE_ROOT,
      changedFiles: [abs('.github/workflows/ci.yml')],
      llmEnabled: false,
    });
    expect(result.triggered).toBe(true);
    expect(result.reasons[0].trigger).toBe('config-changed');
  });

  it('triggers when a changed file does not resolve as a module in the graph (e.g. JSON data)', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = checkSafeMode({
      graph,
      rootDir: FIXTURE_ROOT,
      changedFiles: [abs('src/data.json')],
      llmEnabled: false,
    });
    expect(result.triggered).toBe(true);
    expect(result.reasons[0].trigger).toBe('out-of-graph');
  });

  it('triggers when the graph failed to build', () => {
    const result = checkSafeMode({
      graph: undefined,
      graphBuildError: new Error('ts-morph blew up'),
      rootDir: FIXTURE_ROOT,
      changedFiles: [],
      llmEnabled: false,
    });
    expect(result.triggered).toBe(true);
    expect(result.reasons[0].trigger).toBe('graph-build-failed');
    expect(result.reasons[0].message).toContain('ts-morph blew up');
  });

  it('triggers on an unresolved file on the reachability path when the LLM fallback is off', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = checkSafeMode({
      graph,
      rootDir: FIXTURE_ROOT,
      changedFiles: [abs('src/nonLiteralDynamic.ts')],
      llmEnabled: false,
    });
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.trigger === 'unresolved-on-path')).toBe(true);
  });

  it('does NOT trigger unresolved-on-path when the LLM fallback is enabled', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = checkSafeMode({
      graph,
      rootDir: FIXTURE_ROOT,
      changedFiles: [abs('src/nonLiteralDynamic.ts')],
      llmEnabled: true,
    });
    expect(result.reasons.some((r) => r.trigger === 'unresolved-on-path')).toBe(false);
  });

  it('does not trigger for an ordinary, fully-resolved change', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const result = checkSafeMode({
      graph,
      rootDir: FIXTURE_ROOT,
      changedFiles: [abs('src/a.ts')],
      llmEnabled: false,
    });
    expect(result.triggered).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});
