import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGraph } from '../src/graph.js';
import { MockJudge, OpenAICompatJudge, applyLlmFallback } from '../src/llm.js';

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

describe('OpenAICompatJudge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a well-formed judge response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"affects": true, "confidence": 0.9, "reason": "looks related"}' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const judge = new OpenAICompatJudge({ baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
    const result = await judge.canAffect({ diff: 'diff', testFile: 't.ts', unresolvedFile: 'u.ts' });

    expect(result).toEqual({ affects: true, confidence: 0.9, reason: 'looks related' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('llama3');
  });

  it('sends an Authorization header only when an apiKey is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"affects": false, "confidence": 1, "reason": "no"}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const judge = new OpenAICompatJudge({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' });
    await judge.canAffect({ diff: '', testFile: 't.ts', unresolvedFile: 'u.ts' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer sk-test');
  });

  it('fails open (include, zero confidence) on a non-2xx response instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    const judge = new OpenAICompatJudge({ baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
    const result = await judge.canAffect({ diff: '', testFile: 't.ts', unresolvedFile: 'u.ts' });

    expect(result.affects).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('llm-judge call failed');
  });

  it('fails open when the response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
      }),
    );

    const judge = new OpenAICompatJudge({ baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
    const result = await judge.canAffect({ diff: '', testFile: 't.ts', unresolvedFile: 'u.ts' });

    expect(result.affects).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('llm-judge call failed');
  });

  it('fails open when fetch itself rejects (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const judge = new OpenAICompatJudge({ baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
    const result = await judge.canAffect({ diff: '', testFile: 't.ts', unresolvedFile: 'u.ts' });

    expect(result.affects).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('ECONNREFUSED');
  });
});
