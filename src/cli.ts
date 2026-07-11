#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command, CommanderError } from 'commander';
import ts from 'typescript';
import { buildGraph, type ImportGraph } from './graph.js';
import { OpenAICompatJudge, applyLlmFallback } from './llm.js';
import { checkSafeMode } from './safemode.js';
import { getChangedFiles, isTestFile, realExec, selectTests, type SelectionResult } from './select.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toRel(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath).split(path.sep).join('/');
}

/** Validates tsconfig.json with the exact same (JSONC-tolerant) parser ts-morph uses internally. */
function validateTsConfig(tsConfigFilePath: string): string | undefined {
  if (!existsSync(tsConfigFilePath)) return `no tsconfig.json found at ${tsConfigFilePath}`;
  const result = ts.readConfigFile(tsConfigFilePath, ts.sys.readFile);
  if (result.error) return ts.flattenDiagnosticMessageText(result.error.messageText, '\n');
  return undefined;
}

interface SelectOutput {
  mode: 'selected' | 'safe-mode';
  selected: string[];
  total: number;
  reasons: Record<string, string[]>;
  safeModeReasons: string[];
  command?: string[];
}

function buildSelectOutput(
  rootDir: string,
  graph: ImportGraph | undefined,
  selection: SelectionResult,
  safeModeTriggered: boolean,
  safeModeReasons: string[],
  runnerArgs: string | undefined,
): SelectOutput {
  const relSelected = selection.selected.map((f) => toRel(rootDir, f)).sort();
  const reasons: Record<string, string[]> = {};
  for (const [test, chain] of selection.reasons) {
    reasons[toRel(rootDir, test)] = chain.map((f) => toRel(rootDir, f));
  }
  const total = graph ? [...graph.nodes.keys()].filter((f) => isTestFile(f, rootDir)).length : selection.total;
  const mode: SelectOutput['mode'] = safeModeTriggered ? 'safe-mode' : 'selected';
  const command = runnerArgs
    ? mode === 'safe-mode'
      ? runnerArgs.split(' ')
      : [...runnerArgs.split(' '), ...relSelected]
    : undefined;
  return { mode, selected: relSelected, total, reasons, safeModeReasons, ...(command ? { command } : {}) };
}

function printHuman(output: SelectOutput): void {
  if (output.mode === 'safe-mode') {
    console.log(`safe mode — running the full suite (${output.total} tests)`);
    for (const reason of output.safeModeReasons) console.log(`  - ${reason}`);
  } else {
    console.log(`${output.selected.length} of ${output.total} tests affected:`);
    for (const test of output.selected) {
      const chain = output.reasons[test] ?? [test];
      console.log(`  ${chain.join(' -> ')}`);
    }
  }
  if (output.command) console.log(`\ncommand: ${output.command.join(' ')}`);
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('sts')
    .description('LLM-aware test selection for CI, based on the diff dependency graph')
    .version('0.1.0')
    .exitOverride();

  program
  .command('select')
  .description('select the tests affected by the diff against --base')
  .option('--base <ref>', 'git ref to diff against', 'main')
  .option('--json', 'print machine-readable JSON', false)
  .option('--runner-args <cmd>', 'test runner command to prefix the selection with, e.g. "npx vitest run"')
  .option('--llm-base-url <url>', 'enable the LLM fallback via an OpenAI-compatible endpoint (e.g. Ollama)')
  .option('--llm-model <model>', 'model name to use with --llm-base-url', 'gpt-4o-mini')
  .action(async (opts: { base: string; json: boolean; runnerArgs?: string; llmBaseUrl?: string; llmModel: string }) => {
    const rootDir = process.cwd();
    const tsConfigFilePath = path.join(rootDir, 'tsconfig.json');

    const configError = validateTsConfig(tsConfigFilePath);
    if (configError) {
      console.error(`smart-test-select: ${configError}`);
      process.exitCode = 2;
      return;
    }

    let changedFiles: string[];
    try {
      changedFiles = getChangedFiles(opts.base, rootDir, realExec);
    } catch (err) {
      console.error(`smart-test-select: failed to compute git diff against "${opts.base}": ${errMsg(err)}`);
      process.exitCode = 2;
      return;
    }

    let graph: ImportGraph | undefined;
    let graphBuildError: unknown;
    try {
      graph = buildGraph({ tsConfigFilePath, rootDir });
    } catch (err) {
      graphBuildError = err;
    }

    const llmEnabled = Boolean(opts.llmBaseUrl);
    const safeMode = checkSafeMode({ graph, graphBuildError, rootDir, changedFiles, llmEnabled });

    let selection: SelectionResult = graph
      ? selectTests({ graph, changedFiles })
      : { selected: [], total: 0, reasons: new Map() };

    if (graph && llmEnabled && !safeMode.triggered) {
      const judge = new OpenAICompatJudge({ baseUrl: opts.llmBaseUrl!, model: opts.llmModel });
      let diff = '';
      try {
        diff = realExec('git', ['diff', `${opts.base}...HEAD`], rootDir);
      } catch {
        // Diff text is best-effort context for the judge; selection already succeeded without it.
      }
      selection = await applyLlmFallback({ judge, graph, changedFiles, diff, baseSelection: selection });
    }

    const output = buildSelectOutput(
      rootDir,
      graph,
      selection,
      safeMode.triggered,
      safeMode.reasons.map((r) => r.message),
      opts.runnerArgs,
    );

    if (opts.json) console.log(JSON.stringify(output, null, 2));
    else printHuman(output);
    process.exitCode = 0;
  });

program
  .command('graph')
  .description('inspect the built dependency graph')
  .option('--stats', 'print graph statistics instead of listing every file', false)
  .action((opts: { stats: boolean }) => {
    const rootDir = process.cwd();
    const tsConfigFilePath = path.join(rootDir, 'tsconfig.json');

    const configError = validateTsConfig(tsConfigFilePath);
    if (configError) {
      console.error(`smart-test-select: ${configError}`);
      process.exitCode = 2;
      return;
    }

    let graph: ImportGraph;
    try {
      graph = buildGraph({ tsConfigFilePath, rootDir });
    } catch (err) {
      console.error(`smart-test-select: failed to build the dependency graph: ${errMsg(err)}`);
      process.exitCode = 2;
      return;
    }

    if (opts.stats) {
      const testFiles = [...graph.nodes.keys()].filter((f) => isTestFile(f, rootDir));
      const unresolved = [...graph.nodes.values()].filter((n) => n.unresolved).length;
      const edges = [...graph.nodes.values()].reduce((sum, n) => sum + n.imports.size, 0);
      console.log(`files: ${graph.nodes.size}`);
      console.log(`edges: ${edges}`);
      console.log(`test files: ${testFiles.length}`);
      console.log(`unresolved: ${unresolved}`);
    } else {
      for (const filePath of [...graph.nodes.keys()].sort()) console.log(toRel(rootDir, filePath));
    }
    process.exitCode = 0;
  });

program
  .command('explain')
  .description('print the dependency chain that selected (or would select) a given test file')
  .argument('<testfile>', 'test file path, relative to the project root')
  .option('--base <ref>', 'git ref to diff against', 'main')
  .action((testfile: string, opts: { base: string }) => {
    const rootDir = process.cwd();
    const tsConfigFilePath = path.join(rootDir, 'tsconfig.json');

    const configError = validateTsConfig(tsConfigFilePath);
    if (configError) {
      console.error(`smart-test-select: ${configError}`);
      process.exitCode = 2;
      return;
    }

    let changedFiles: string[];
    try {
      changedFiles = getChangedFiles(opts.base, rootDir, realExec);
    } catch (err) {
      console.error(`smart-test-select: failed to compute git diff against "${opts.base}": ${errMsg(err)}`);
      process.exitCode = 2;
      return;
    }

    let graph: ImportGraph;
    try {
      graph = buildGraph({ tsConfigFilePath, rootDir });
    } catch (err) {
      console.error(`smart-test-select: failed to build the dependency graph: ${errMsg(err)}`);
      process.exitCode = 2;
      return;
    }

    const selection = selectTests({ graph, changedFiles });
    const abs = path.resolve(rootDir, testfile);
    const chain = selection.reasons.get(abs);
    if (!chain) {
      console.log(`${testfile}: not selected for base "${opts.base}"`);
    } else {
      console.log(chain.map((f) => toRel(rootDir, f)).join(' -> '));
    }
    process.exitCode = 0;
  });

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      process.exitCode = err.exitCode;
      if (err.exitCode !== 0) console.error(`smart-test-select: ${err.message}`);
      return;
    }
    console.error(`smart-test-select: unexpected failure: ${errMsg(err)}`);
    process.exitCode = 2;
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  void run();
}
