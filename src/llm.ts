import { buildReverseGraph, type ImportGraph } from './graph.js';
import { isTestFile, reachableDependents, type SelectionResult } from './select.js';

export interface LlmJudgeInput {
  diff: string;
  testFile: string;
  unresolvedFile: string;
}

export interface LlmJudgeOutput {
  affects: boolean;
  confidence: number;
  reason: string;
}

export interface LlmJudge {
  canAffect(input: LlmJudgeInput): Promise<LlmJudgeOutput>;
}

/**
 * Deterministic judge for tests and offline demos — never touches the network.
 * Responses are keyed by `unresolvedFile::testFile`; anything not configured defaults to
 * "does not affect, fully confident" so tests stay predictable.
 */
export class MockJudge implements LlmJudge {
  private readonly responses: Map<string, LlmJudgeOutput>;

  constructor(responses: Map<string, LlmJudgeOutput> = new Map()) {
    this.responses = responses;
  }

  static key(unresolvedFile: string, testFile: string): string {
    return `${unresolvedFile}::${testFile}`;
  }

  async canAffect(input: LlmJudgeInput): Promise<LlmJudgeOutput> {
    const configured = this.responses.get(MockJudge.key(input.unresolvedFile, input.testFile));
    return (
      configured ?? {
        affects: false,
        confidence: 1,
        reason: 'mock: no scenario configured for this pair',
      }
    );
  }
}

export interface OpenAICompatJudgeOptions {
  /** e.g. https://api.openai.com/v1, or http://localhost:11434/v1 for a local Ollama server. */
  baseUrl: string;
  model: string;
  apiKey?: string;
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

/** Talks to any OpenAI-compatible chat completions endpoint (OpenAI, Azure OpenAI, Ollama, vLLM, ...). */
export class OpenAICompatJudge implements LlmJudge {
  constructor(private readonly options: OpenAICompatJudgeOptions) {}

  async canAffect(input: LlmJudgeInput): Promise<LlmJudgeOutput> {
    try {
      const res = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                'A static import-graph analyzer found a dynamic import()/require() it cannot resolve statically.',
                `Unresolved file: ${input.unresolvedFile}`,
                `Candidate test file: ${input.testFile}`,
                'Diff of the change:',
                input.diff,
                '',
                'Could this test plausibly exercise the code reached through that dynamic import?',
                'Respond with ONLY a JSON object: {"affects": boolean, "confidence": number (0-1), "reason": string}.',
              ].join('\n'),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`LLM endpoint responded ${res.status}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(extractJson(text)) as Partial<LlmJudgeOutput>;
      if (typeof parsed.affects !== 'boolean' || typeof parsed.confidence !== 'number') {
        throw new Error('malformed judge response');
      }
      return { affects: parsed.affects, confidence: parsed.confidence, reason: parsed.reason ?? '' };
    } catch (err) {
      // A failed call must never silently exclude a test. Default to "include, zero confidence"
      // so the add-only rule (confidence < 0.8 || affects) kicks in downstream.
      return {
        affects: true,
        confidence: 0,
        reason: `llm-judge call failed, defaulting to include: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

export interface LlmFallbackOptions {
  judge: LlmJudge;
  graph: ImportGraph;
  changedFiles: string[];
  diff: string;
  baseSelection: SelectionResult;
  testGlobs?: string[];
}

/**
 * Asks the judge about every test not already statically selected, for every unresolved file
 * reachable from a changed file. Invariant: this only ever *adds* to `baseSelection.selected` —
 * it must never remove an entry the static graph already found.
 */
export async function applyLlmFallback(options: LlmFallbackOptions): Promise<SelectionResult> {
  const { judge, graph, changedFiles, diff, baseSelection, testGlobs } = options;
  const reverse = buildReverseGraph(graph);
  const selected = new Set(baseSelection.selected);
  const reasons = new Map(baseSelection.reasons);
  const allTestFiles = [...graph.nodes.keys()].filter((f) => isTestFile(f, graph.rootDir, testGlobs));

  const unresolvedFiles = new Set<string>();
  for (const changed of changedFiles) {
    if (!graph.nodes.has(changed)) continue;
    const { visited } = reachableDependents(reverse, changed);
    for (const node of visited) {
      if (graph.nodes.get(node)?.unresolved) unresolvedFiles.add(node);
    }
  }

  for (const unresolvedFile of unresolvedFiles) {
    for (const testFile of allTestFiles) {
      if (selected.has(testFile)) continue;
      const verdict = await judge.canAffect({ diff, testFile, unresolvedFile });
      if (verdict.affects || verdict.confidence < 0.8) {
        selected.add(testFile);
        reasons.set(testFile, [testFile, `llm-fallback:${unresolvedFile}`, verdict.reason]);
      }
    }
  }

  return { selected: [...selected], total: baseSelection.total, reasons };
}
