import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildReverseGraph, type ImportGraph } from './graph.js';

export const DEFAULT_TEST_GLOBS = ['**/*.{test,spec}.{ts,tsx,js,jsx}'];

/** Minimal glob→RegExp converter: supports `**`, `*`, `?`, and `{a,b,c}` alternation. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      re += '(?:.*/)?';
      i += 3;
    } else if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 2;
    } else if (c === '*') {
      re += '[^/]*';
      i += 1;
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i += 1;
        continue;
      }
      const alts = glob
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      re += `(?:${alts})`;
      i = end + 1;
    } else if ('.+^$()|[]\\'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

export function isTestFile(filePath: string, rootDir: string, testGlobs: string[] = DEFAULT_TEST_GLOBS): boolean {
  const rel = path.relative(rootDir, filePath).split(path.sep).join('/');
  return testGlobs.some((glob) => globToRegExp(glob).test(rel));
}

export interface SelectionResult {
  selected: string[];
  total: number;
  /** testFile -> chain from the test to the changed file it depends on, e.g. [test.ts, a.ts, changed.ts]. */
  reasons: Map<string, string[]>;
}

export interface SelectOptions {
  graph: ImportGraph;
  changedFiles: string[];
  testGlobs?: string[];
}

/** BFS over the reverse graph from `changed`, returning every file that transitively depends on it. */
export function reachableDependents(
  reverse: Map<string, Set<string>>,
  changed: string,
): { visited: Set<string>; parent: Map<string, string> } {
  const parent = new Map<string, string>();
  const visited = new Set<string>([changed]);
  const queue: string[] = [changed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of reverse.get(current) ?? []) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      parent.set(dependent, current);
      queue.push(dependent);
    }
  }
  return { visited, parent };
}

/**
 * Reverse transitive reachability: from each changed file, walk dependents (who imports it,
 * who imports those, ...) and keep whichever reachable files are test files. The invariant
 * this function must uphold: never drop a test that is actually reachable — callers layer
 * safe-mode / LLM fallback on top for what this static walk cannot see.
 */
export function selectTests(options: SelectOptions): SelectionResult {
  const testGlobs = options.testGlobs ?? DEFAULT_TEST_GLOBS;
  const reverse = buildReverseGraph(options.graph);
  const allTestFiles = [...options.graph.nodes.keys()].filter((f) => isTestFile(f, options.graph.rootDir, testGlobs));

  const reasons = new Map<string, string[]>();
  const selected = new Set<string>();

  for (const changed of options.changedFiles) {
    if (!options.graph.nodes.has(changed)) continue; // not a graph node — caller/safemode decides what to do

    if (isTestFile(changed, options.graph.rootDir, testGlobs) && !selected.has(changed)) {
      selected.add(changed);
      reasons.set(changed, [changed]);
    }

    const { visited, parent } = reachableDependents(reverse, changed);

    for (const node of visited) {
      if (node === changed) continue;
      if (selected.has(node)) continue;
      if (!isTestFile(node, options.graph.rootDir, testGlobs)) continue;

      const chain: string[] = [node];
      let cur = node;
      while (cur !== changed) {
        const p = parent.get(cur);
        if (!p) break;
        chain.push(p);
        cur = p;
      }
      selected.add(node);
      reasons.set(node, chain);
    }
  }

  return { selected: [...selected], total: allTestFiles.length, reasons };
}

export type ExecFn = (cmd: string, args: string[], cwd: string) => string;

/** Real `git diff` exec — never called from unit tests, only from the CLI. */
export const realExec: ExecFn = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' });

/** Returns absolute paths of files changed between `base` and HEAD. */
export function getChangedFiles(base: string, rootDir: string, exec: ExecFn): string[] {
  const output = exec('git', ['diff', '--name-only', `${base}...HEAD`], rootDir);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((rel) => path.resolve(rootDir, rel));
}
