import type { Env } from './auth'
import type { SqlDatabase } from './sql'

export const AI_DAILY_LIMIT = 40

/** Server-side allowlist; the browser never chooses the model. */
const MODELS = [
  'deepseek/deepseek-v4-flash',
  'mimo/mimo-v2.5',
  'z-ai/glm-5.3-flash',
  'openai/gpt-6-luna',
] as const

export type NoteSource = { title: string; body: string }

export function aiConfigured(env: Env): boolean {
  return Boolean(env.OPENAI_API_KEY)
}

export function aiModel(env: Env): string {
  const configured = env.AI_MODEL ?? ''
  return (MODELS as readonly string[]).includes(configured)
    ? configured
    : MODELS[0]!
}

const MAX_SOURCE_CHARS = 14_000
const MAX_NOTE_CHARS = 2_500

/** Keep the prompt small and never send more than a handful of notes. */
export function buildSourceBlock(sources: NoteSource[]): string {
  let budget = MAX_SOURCE_CHARS
  const parts: string[] = []
  for (const [index, source] of sources.entries()) {
    const body = source.body.slice(0, MAX_NOTE_CHARS)
    if (body.length > budget) break
    budget -= body.length
    parts.push(`[${index + 1}] ${source.title}\n${body}`)
  }
  return parts.join('\n\n')
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

async function complete(
  env: Env,
  messages: Message[],
  maxTokens: number,
): Promise<string> {
  const base = (
    env.OPENAI_BASE_URL || 'https://freebuff.com/api/v1/paid'
  ).replace(/\/+$/, '')
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: aiModel(env),
      messages,
      temperature: 0.25,
      max_tokens: maxTokens,
      stream: false,
    }),
  })
  if (!response.ok) {
    throw new Error(`The AI service answered with ${response.status}.`)
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : '',
      )
      .join('')
      .trim()
    if (text) return text
  }
  throw new Error('The AI service returned an empty answer.')
}

const TUTOR =
  'You are the study assistant inside Studydeck, a student planner. Answer like a good tutor: direct, specific and honest about what the notes do not cover. ' +
  'Use plain text with short "- " bullet lines; no HTML and no tables. ' +
  'Style: write the way a person writes. Use full stops, commas and colons, and never em dashes or en dashes as punctuation. ' +
  'Skip openers such as "Great question" and closing filler. Avoid hype words (unlock, seamless, elevate, delve, journey). ' +
  'Never invent facts: if the student’s notes do not contain the answer, say so plainly and suggest what to add to their notes.'

const systemPrompt = (context: string): string =>
  context ? `${TUTOR}\n\n${context}` : TUTOR

export function summariseNotes(
  env: Env,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    env,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `Summarise these notes for revision. Give: a two-sentence overview, then 5–8 key points as "- " bullets, then a line "Key terms:" with the terms that must be memorised. ` +
          `Refer to the notes you used by their bracketed number, like [1].\n\n${buildSourceBlock(sources)}`,
      },
    ],
    800,
  )
}

export function askNotes(
  env: Env,
  question: string,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    env,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `Answer the student’s question using only the notes below. Cite every claim with the bracketed source number, like [2]. ` +
          `If the notes do not cover it, say "I couldn't find that in your notes" and say what to add.\n\n` +
          `Notes:\n${buildSourceBlock(sources)}\n\nQuestion: ${question}`,
      },
    ],
    700,
  )
}

export async function usedAi(
  db: SqlDatabase,
  owner: string,
): Promise<number> {
  const day = new Date().toISOString().slice(0, 10)
  const row = await db
    .prepare('SELECT count FROM ai_usage WHERE owner_sub = ? AND day = ?')
    .bind(owner, day)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function consumeAi(
  db: SqlDatabase,
  owner: string,
): Promise<{ ok: boolean; remaining: number }> {
  const used = await usedAi(db, owner)
  if (used >= AI_DAILY_LIMIT) return { ok: false, remaining: 0 }
  const day = new Date().toISOString().slice(0, 10)
  await db
    .prepare(
      'INSERT INTO ai_usage (owner_sub, day, count) VALUES (?, ?, 1) ON CONFLICT(owner_sub, day) DO UPDATE SET count = count + 1',
    )
    .bind(owner, day)
    .run()
  return { ok: true, remaining: AI_DAILY_LIMIT - used - 1 }
}
