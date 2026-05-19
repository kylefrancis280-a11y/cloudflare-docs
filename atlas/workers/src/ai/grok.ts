// atlas/workers/src/handlers/grok.ts
// Grok-3 (xAI) replacement for all previous Claude calls
import type { Env } from '../env';

const MODEL = 'grok-3';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

export interface GrokMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  system?: string;
  messages: GrokMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface GrokResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call Grok-3 with a clean, simple interface
 */
export async function callGrok(env: Env, opts: CallOptions): Promise<GrokResponse> {
  if (!env.GROK_API_KEY) {
    throw new Error('GROK_API_KEY is not configured in environment variables');
  }

  const messages: GrokMessage[] = [];

  // Add system prompt if provided
  if (opts.system) {
    messages.push({ role: 'system', content: opts.system });
  }

  // Add user/assistant messages
  messages.push(...opts.messages);

  const res = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 1200,
      temperature: opts.temperature ?? 0.7,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`grok_api_error_${res.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await res.json() as any;

  const text = data.choices?.[0]?.message?.content || '';

  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: MODEL,
  };
}

/**
 * Extract JSON from Grok response (Grok is very reliable with JSON)
 */
export function extractJson<T = unknown>(text: string): { ok: true; data: T } | { ok: false; raw: string } {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return { ok: true, data: JSON.parse(cleaned) as T };
  } catch {}

  // Try to find the first JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return { ok: true, data: JSON.parse(match[0]) as T };
    } catch {}
  }

  return { ok: false, raw: cleaned };
}
