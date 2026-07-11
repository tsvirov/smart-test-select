import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph.js';
import { MockJudge, applyLlmFallback } from '../src/llm.js';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-repo');
const TSCONFIG = path.join(FIXTURE_ROOT, 'tsconfig.json');

function abs(relPath: string): string {
  return path.join(FIXTURE_ROOT, relPath);
}
function rel(p: string): string {
  return path.relative(FIXTURE_ROOT, p).split(path.sep).join('/');
}

describe('MockJudge', () => {
  it('returns the configured verdict for a pair, and a safe "no effect" default otherwise', async () => {
    const judge = new MockJudge(
      new Map([[MockJudge.key('u.ts', 't.ts'), { affects: true, confidence: 0.9, reason: 'yes' }]]),
    );
    await expect(judge.canAffect({ diff: '', testFile: 't.ts', unresolvedFile: 'u.ts' })).resolves.toEqual({
      affects: true,
      confidence: 0.9,
      reason: 'yes',
    });
    await expect(
      judge.canAffect({ diff: '', testFile: 'other.ts', unresolvedFile: 'u.ts' }),
    ).resolves.toMatchObject({ affects: false, confidence: 1 });
  });
});

describe('applyLlmFallback add-only invariant', () => {
  it('never removes a test the static graph already selected, even when the judge says affects:false', async () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const baseSelection = {
      selected: [abs('tests/a.test.ts')],
      total: 8,
      reasons: new Map([[abs('tests/a.test.ts'), [abs('tests/a.test.ts')]]]),
    };
    const judge = new MockJudge(); // unconfigured -> always "does not affect"
    const result = await applyLlmFallback({
      judge,
      graph,
      changedFiles: [abs('src/nonLiteralDynamic.ts')],
      diff: '',
      baseSelection,
    });
    expect(result.selected.map(rel)).toEqual(['tests/a.test.ts']);
  });

  it('adds a test the static graph missed when the judge says affects:true for an unresolved file', async () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const baseSelection = { selected: [], total: 8, reasons: new Map() };
    const judge = new MockJudge(
      new Map([
        [
          MockJudge.key(abs('src/nonLiteralDynamic.ts'), abs('tests/untouched.test.ts')),
          { affects: true, confidence: 0.95, reason: 'plausible' },
        ],
      ]),
    );
    const result = await applyLlmFallback({
      judge,
      graph,
      changedFiles: [abs('src/nonLiteralDynamic.ts')],
      diff: '',
      baseSelection,
    });
    expect(result.selected.map(rel)).toContain('tests/untouched.test.ts');
  });

  it('adds a test when confidence is below 0.8, even if affects is false', async () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const baseSelection = { selected: [], total: 8, reasons: new Map() };
    const judge = new MockJudge(
      new Map([
        [
          MockJudge.key(abs('src/nonLiteralDynamic.ts'), abs('tests/untouched.test.ts')),
          { affects: false, confidence: 0.5, reason: 'unsure' },
        ],
      ]),
    );
    const result = await applyLlmFallback({
      judge,
      graph,
      changedFiles: [abs('src/nonLiteralDynamic.ts')],
      diff: '',
      baseSelection,
    });
    expect(result.selected.map(rel)).toContain('tests/untouched.test.ts');
  });
});
