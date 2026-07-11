import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph.js';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-repo');
const TSCONFIG = path.join(FIXTURE_ROOT, 'tsconfig.json');

function rel(p: string): string {
  return path.relative(FIXTURE_ROOT, p).split(path.sep).join('/');
}

describe('buildGraph', () => {
  it('builds a node for every source and test file', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const files = [...graph.nodes.keys()].map(rel).sort();
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/barrel.ts');
    expect(files).toContain('tests/a.test.ts');
    expect(files).not.toContain('src/data.json'); // .json isn't a ts-morph source file
  });

  it('resolves barrel re-exports (export * from) as edges to the re-exported files', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const barrel = [...graph.nodes.values()].find((n) => rel(n.filePath) === 'src/barrel.ts')!;
    expect([...barrel.imports].map(rel).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('includes a type-only import as a real dependency edge', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const node = [...graph.nodes.values()].find((n) => rel(n.filePath) === 'src/typesOnly.ts')!;
    expect([...node.imports].map(rel)).toEqual(['src/a.ts']);
    expect(node.unresolved).toBe(false);
  });

  it('resolves a tsconfig path alias exactly like the compiler would', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const node = [...graph.nodes.values()].find((n) => rel(n.filePath) === 'src/aliasConsumer.ts')!;
    expect([...node.imports].map(rel)).toEqual(['src/utils/helper.ts']);
  });

  it('resolves a literal dynamic import() exactly like a static import', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const node = [...graph.nodes.values()].find((n) => rel(n.filePath) === 'src/literalDynamic.ts')!;
    expect([...node.imports].map(rel)).toEqual(['src/a.ts']);
    expect(node.unresolved).toBe(false);
  });

  it('flags a non-literal dynamic import() as unresolved instead of silently dropping it', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const node = [...graph.nodes.values()].find((n) => rel(n.filePath) === 'src/nonLiteralDynamic.ts')!;
    expect(node.unresolved).toBe(true);
    expect(node.imports.size).toBe(0);
  });

  it('does not add an edge for a bare (npm/node builtin) specifier', () => {
    const graph = buildGraph({ tsConfigFilePath: TSCONFIG, rootDir: FIXTURE_ROOT });
    const node = [...graph.nodes.values()].find((n) => rel(n.filePath) === 'tests/a.test.ts')!;
    // imports 'vitest' (bare) and '../src/a.js' (local) — only the local one is a graph edge.
    expect([...node.imports].map(rel)).toEqual(['src/a.ts']);
    expect(node.unresolved).toBe(false);
  });
});
