import path from 'node:path';
import { buildReverseGraph, type ImportGraph } from './graph.js';
import { reachableDependents } from './select.js';

export type SafeModeTrigger = 'config-changed' | 'out-of-graph' | 'graph-build-failed' | 'unresolved-on-path';

export interface SafeModeReason {
  trigger: SafeModeTrigger;
  message: string;
}

export interface SafeModeResult {
  triggered: boolean;
  reasons: SafeModeReason[];
}

/** Files whose content shapes how tests run, not just what they cover — never worth narrowing. */
function isConfigFile(relPosixPath: string): boolean {
  const base = relPosixPath.split('/').pop() ?? relPosixPath;
  if (base === 'package.json' || base === 'package-lock.json') return true;
  if (/^tsconfig(\..+)?\.json$/.test(base)) return true;
  if (/^jest\.config\.(js|cjs|mjs|ts|json)$/.test(base)) return true;
  if (/^vitest\.config\.(js|cjs|mjs|ts)$/.test(base)) return true;
  if (/^\.env(\..+)?$/.test(base)) return true;
  if (relPosixPath.startsWith('.github/')) return true;
  return false;
}

/** Extensions the graph builder can meaningfully place as a node; anything else that changes is invisible to it. */
const CODE_RELEVANT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);

function toRelPosix(filePath: string, rootDir: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

export interface CheckSafeModeOptions {
  /** undefined when the graph failed to build. */
  graph: ImportGraph | undefined;
  graphBuildError?: unknown;
  rootDir: string;
  changedFiles: string[];
  llmEnabled: boolean;
}

/**
 * Decides whether to bail out to "run the whole suite" instead of trusting the static
 * selection. Every trigger produces an explicit, named reason — this function must never
 * narrow silently, so an empty `reasons` list is the only way `triggered` is false.
 */
export function checkSafeMode(options: CheckSafeModeOptions): SafeModeResult {
  const reasons: SafeModeReason[] = [];

  if (!options.graph) {
    reasons.push({
      trigger: 'graph-build-failed',
      message: `dependency graph failed to build (${String(
        options.graphBuildError instanceof Error ? options.graphBuildError.message : options.graphBuildError,
      )}) — running the full suite`,
    });
    return { triggered: true, reasons };
  }

  const graph: ImportGraph = options.graph;

  for (const changed of options.changedFiles) {
    const rel = toRelPosix(changed, options.rootDir);

    if (isConfigFile(rel)) {
      reasons.push({
        trigger: 'config-changed',
        message: `${rel} changed — running the full suite`,
      });
      continue;
    }

    if (!graph.nodes.has(changed)) {
      const ext = path.extname(changed);
      if (CODE_RELEVANT_EXTENSIONS.has(ext)) {
        reasons.push({
          trigger: 'out-of-graph',
          message: `${rel} changed but does not resolve as a module in the dependency graph — running the full suite`,
        });
      }
      continue;
    }
  }

  if (!options.llmEnabled) {
    const reverse = buildReverseGraph(graph);
    const flagged = new Set<string>();
    for (const changed of options.changedFiles) {
      if (!graph.nodes.has(changed)) continue;
      const { visited } = reachableDependents(reverse, changed);
      for (const node of visited) {
        if (flagged.has(node)) continue;
        const fileNode = graph.nodes.get(node);
        if (fileNode?.unresolved) {
          flagged.add(node);
          reasons.push({
            trigger: 'unresolved-on-path',
            message: `${toRelPosix(
              node,
              options.rootDir,
            )} has an unresolvable dynamic import()/require() on the reachability path and LLM fallback is off — running the full suite`,
          });
        }
      }
    }
  }

  return { triggered: reasons.length > 0, reasons };
}
