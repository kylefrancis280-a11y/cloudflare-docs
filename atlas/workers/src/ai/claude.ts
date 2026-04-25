import type { Env } from '../env';

// Single Claude entry point — Sonnet 4.6 with prompt caching on the
// analytical-framework system prompt (it doesn't change per ticker, so
// caching it cuts cost and latency dramatically).
//
// Docs: https://docs.anthropic.com/en/api/messages
//       https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
}

export interface CallOptions {
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: ClaudeMessage[];
  maxTokens?: number;
  thinking?: { type: 'enabled'; budget_tokens: number };
}

export interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  stopReason: string;
}

export async function callClaude(env: Env, opts: CallOptions): Promise<ClaudeResponse> {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages,
  };
  if (opts.thinking) body.thinking = opts.thinking;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`claude_api_error_${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  const text = (data.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: data.usage?.cache_creation_input_tokens ?? 0,
    stopReason: data.stop_reason ?? '',
  };
}

// Strict JSON extraction — Claude is good but not perfect. Strip code fences,
// then try to parse. If still bad, surface raw text via 'raw' so callers can fall back.
export function extractJson<T = unknown>(text: string): { ok: true; data: T } | { ok: false; raw: string } {
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try { return { ok: true, data: JSON.parse(stripped) as T }; } catch {}
  // Try to find the first {...} block
  const m = stripped.match(/\{[\s\S]+\}/);
  if (m) {
    try { return { ok: true, data: JSON.parse(m[0]) as T }; } catch {}
  }
  return { ok: false, raw: stripped };
}
