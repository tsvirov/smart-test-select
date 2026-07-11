import path from 'node:path';
import { Node, Project, SyntaxKind, ts } from 'ts-morph';

/** One file's outgoing static/resolvable dependencies. */
export interface FileNode {
  filePath: string;
  /** Absolute paths of files this file imports (re-exports, literal dynamic import()/require() included). */
  imports: Set<string>;
  /**
   * True when this file contains a non-literal `import(expr)` / `require(expr)`, or a
   * local-looking specifier (relative or path-alias) that could not be resolved on disk.
   * Never silently dropped — callers must treat this as "graph is incomplete for this file".
   */
  unresolved: boolean;
}

export interface ImportGraph {
  rootDir: string;
  nodes: Map<string, FileNode>;
}

export interface BuildGraphOptions {
  tsConfigFilePath: string;
  /** Defaults to the directory containing tsConfigFilePath. */
  rootDir?: string;
}

function normalize(p: string): string {
  return path.resolve(p);
}

function isWithinRoot(filePath: string, rootDir: string): boolean {
  const rel = path.relative(rootDir, filePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isLocalSpecifier(specifier: string, compilerOptions: ts.CompilerOptions): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return true;
  const paths = compilerOptions.paths;
  if (paths) {
    for (const pattern of Object.keys(paths)) {
      const prefix = pattern.replace(/\*$/, '');
      if (prefix.length > 0 && specifier.startsWith(prefix)) return true;
    }
  }
  return false;
}

function addResolved(
  node: FileNode,
  specifier: string,
  containingFile: string,
  compilerOptions: ts.CompilerOptions,
  rootDir: string,
): void {
  const resolved = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys).resolvedModule
    ?.resolvedFileName;
  if (!resolved) {
    if (isLocalSpecifier(specifier, compilerOptions)) {
      // Looks like it should point inside the project but we couldn't resolve it on disk.
      // Never guess silently — flag the file as unresolved so callers fall back to safe mode.
      node.unresolved = true;
    }
    // Otherwise it's a bare specifier (npm package / node builtin) — legitimately outside the graph.
    return;
  }
  const norm = normalize(resolved);
  if (!isWithinRoot(norm, rootDir)) return; // resolved into node_modules or outside the project — not a graph edge
  node.imports.add(norm);
}

/**
 * Builds a static import graph for a TypeScript/JavaScript project using ts-morph + the
 * real TypeScript module resolver (so tsconfig `paths` aliases resolve exactly like they
 * would for the compiler, no separate alias-matching logic to drift out of sync).
 */
export function buildGraph(options: BuildGraphOptions): ImportGraph {
  const project = new Project({ tsConfigFilePath: options.tsConfigFilePath });
  const rootDir = normalize(options.rootDir ?? path.dirname(options.tsConfigFilePath));
  const compilerOptions = project.getCompilerOptions();
  const nodes = new Map<string, FileNode>();

  for (const sf of project.getSourceFiles()) {
    const filePath = normalize(sf.getFilePath());
    if (!isWithinRoot(filePath, rootDir)) continue;

    const node: FileNode = { filePath, imports: new Set(), unresolved: false };
    nodes.set(filePath, node);

    // Static imports, including type-only imports (safe to include — they're still a real
    // dependency edge for analysis purposes, just erased at runtime).
    for (const imp of sf.getImportDeclarations()) {
      addResolved(node, imp.getModuleSpecifierValue(), filePath, compilerOptions, rootDir);
    }

    // Re-exports / barrel files: `export { a } from './x'` and `export * from './x'`.
    for (const exp of sf.getExportDeclarations()) {
      const spec = exp.getModuleSpecifierValue();
      if (spec) addResolved(node, spec, filePath, compilerOptions, rootDir);
    }

    // Dynamic import() and require() calls.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
      const isRequire = Node.isIdentifier(expr) && expr.getText() === 'require';
      if (!isDynamicImport && !isRequire) continue;

      const [firstArg] = call.getArguments();
      if (firstArg && Node.isStringLiteral(firstArg)) {
        // Literal argument — resolve exactly like a static import.
        addResolved(node, firstArg.getLiteralValue(), filePath, compilerOptions, rootDir);
      } else {
        // Non-literal target (`import(pathVar)` / `require(pathVar)`) — cannot know statically
        // what this loads. Flag it loudly rather than pretending the file has no such edge.
        node.unresolved = true;
      }
    }
  }

  return { rootDir, nodes };
}

/** Builds the reverse adjacency (dependents) map: file -> set of files that import it. */
export function buildReverseGraph(graph: ImportGraph): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();
  for (const filePath of graph.nodes.keys()) reverse.set(filePath, new Set());
  for (const node of graph.nodes.values()) {
    for (const dep of node.imports) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep)!.add(node.filePath);
    }
  }
  return reverse;
}
