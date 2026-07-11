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
});
