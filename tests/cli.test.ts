import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli.js';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-repo');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Fresh copy of the fixture repo, with a "baseline" commit and a "main" tag/branch to diff against. */
function setupRepo(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sts-cli-')));
  cpSync(FIXTURE_ROOT, dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'work']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'baseline']);
  git(dir, ['branch', 'main']);
  return dir;
}

describe('CLI', () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it('select --json exits 0 and selects exactly the tests reachable from the diff', async () => {
    const dir = setupRepo();
    appendFileSync(path.join(dir, 'src/a.ts'), '\nexport const marker = true;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'change a.ts']);
    process.chdir(dir);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await run(['node', 'sts', 'select', '--base', 'main', '--json']);

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(logs.join('\n'));
    expect(output.mode).toBe('selected');
    expect([...output.selected].sort()).toEqual(
      ['tests/a.test.ts', 'tests/b.test.ts', 'tests/barrel.test.ts', 'tests/typesOnly.test.ts', 'tests/literalDynamic.test.ts'].sort(),
    );
    expect(output.total).toBe(8);
  });

  it('explain prints a non-empty chain for a test that was actually selected', async () => {
    const dir = setupRepo();
    appendFileSync(path.join(dir, 'src/a.ts'), '\nexport const marker = true;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'change a.ts']);
    process.chdir(dir);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await run(['node', 'sts', 'explain', 'tests/b.test.ts', '--base', 'main']);

    expect(process.exitCode).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('->');
    expect(logs[0]).toContain('tests/b.test.ts');
  });

  it('falls back to safe mode with an explicit reason when package.json changes', async () => {
    const dir = setupRepo();
    appendFileSync(path.join(dir, 'package.json'), '\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'touch package.json']);
    process.chdir(dir);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await run(['node', 'sts', 'select', '--base', 'main', '--json']);

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(logs.join('\n'));
    expect(output.mode).toBe('safe-mode');
    expect(output.safeModeReasons.length).toBeGreaterThan(0);
    expect(output.safeModeReasons[0]).toContain('package.json');
  });

  it('exits with code 2 when there is no tsconfig.json to analyze', async () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sts-cli-empty-')));
    process.chdir(dir);

    vi.spyOn(console, 'error').mockImplementation(() => {});

    await run(['node', 'sts', 'select']);

    expect(process.exitCode).toBe(2);
  });

  it('reports mode: selected with an empty selection when there is no diff', async () => {
    const dir = setupRepo();
    process.chdir(dir);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await run(['node', 'sts', 'select', '--base', 'main', '--json']);

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(logs.join('\n'));
    expect(output).toMatchObject({ mode: 'selected', selected: [], total: 8 });
  });

  it('explain exits with code 2 when there is no tsconfig.json to analyze', async () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sts-cli-empty-')));
    process.chdir(dir);

    vi.spyOn(console, 'error').mockImplementation(() => {});

    await run(['node', 'sts', 'explain', 'tests/a.test.ts']);

    expect(process.exitCode).toBe(2);
  });

  it('graph --stats prints file/edge/test/unresolved counts', async () => {
    const dir = setupRepo();
    process.chdir(dir);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await run(['node', 'sts', 'graph', '--stats']);

    expect(process.exitCode).toBe(0);
    const text = logs.join('\n');
    expect(text).toMatch(/files: 19/); // 11 src/*.ts + 8 tests/*.test.ts (src/data.json is not a .ts node)
    expect(text).toMatch(/test files: 8/);
    expect(text).toMatch(/unresolved: 1/); // src/nonLiteralDynamic.ts
  });

  it('graph (no --stats) lists every file path in the graph', async () => {
    const dir = setupRepo();
    process.chdir(dir);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await run(['node', 'sts', 'graph']);

    expect(process.exitCode).toBe(0);
    expect(logs).toContain('src/a.ts');
    expect(logs).toContain('tests/a.test.ts');
  });

  it('graph exits with code 2 when there is no tsconfig.json to analyze', async () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sts-cli-empty-')));
    process.chdir(dir);

    vi.spyOn(console, 'error').mockImplementation(() => {});

    await run(['node', 'sts', 'graph']);

    expect(process.exitCode).toBe(2);
  });

  it('select --llm-base-url lets the judge add a test the static graph could not resolve', async () => {
    const dir = setupRepo();
    appendFileSync(path.join(dir, 'src/nonLiteralDynamic.ts'), '\nexport const marker = true;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'change nonLiteralDynamic.ts']);
    process.chdir(dir);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"affects": true, "confidence": 0.99, "reason": "stub"}' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await run(['node', 'sts', 'select', '--base', 'main', '--json', '--llm-base-url', 'http://localhost:11434/v1']);

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(logs.join('\n'));
    expect(output.mode).toBe('selected');
    // the LLM judge was consulted for every test not already statically selected
    expect(fetchMock).toHaveBeenCalled();
    expect(output.selected).toEqual(
      expect.arrayContaining(['tests/nonLiteralDynamic.test.ts', 'tests/aliasConsumer.test.ts', 'tests/untouched.test.ts']),
    );

    vi.unstubAllGlobals();
  });
});
