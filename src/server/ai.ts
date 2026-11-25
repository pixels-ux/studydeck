import { AiError, type Provider } from './providers.ts'
import type { SqlDatabase } from './sql'

export const AI_DAILY_LIMIT = 40

export type NoteSource = { title: string; body: string }

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

/** Every supported provider speaks the OpenAI chat-completions request shape. */
async function complete(
  provider: Provider,
  messages: Message[],
  maxTokens: number,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...provider.headers,
  }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  let response: Response
  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.25,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
  } catch {
    throw new AiError(
      provider.id === 'ollama'
        ? `Could not reach Ollama at ${provider.baseUrl}. Start it with "ollama serve" and check OLLAMA_BASE_URL.`
        : `Could not reach ${provider.label}. Check the server's network and try again.`,
    )
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new AiError(
        `${provider.label} refused the API key. Check the key set on the server.`,
      )
    if (response.status === 429)
      throw new AiError(
        `${provider.label} is rate limiting requests. Try again in a minute.`,
      )
    if (response.status === 404 && provider.id === 'ollama')
      throw new AiError(
        `Ollama does not have the model "${provider.model}". Run "ollama pull ${provider.model}" first.`,
      )
    throw new AiError(`${provider.label} answered with ${response.status}.`)
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
  throw new AiError(`${provider.label} returned an empty answer. Please try again.`)
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
  provider: Provider,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    provider,
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
  provider: Provider,
  question: string,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    provider,
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

/** Material as the library numbers it, so [2] means the same in prompt and UI. */
export type PromptSource = { index: number; sourceTitle: string; text: string }

function citedBlock(sources: PromptSource[]): string {
  return sources
    .map((source) => `[${source.index}] ${source.sourceTitle}\n${source.text}`)
    .join('\n\n')
}

/**
 * A notebook answer: the student's own material, numbered, with the answer
 * asked to name the numbers it used. Retrieval has already picked the pages,
 * so the model only has to read them and stay honest about gaps.
 */
export function answerFromMaterial(
  provider: Provider,
  question: string,
  sources: PromptSource[],
  context = '',
): Promise<string> {
  return complete(
    provider,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `Answer the student’s question using only their material below. After each claim, cite the material it came from with its bracketed number, like [2]. ` +
          `If the material does not cover it, say "I couldn't find that in your material" and name what to add. Do not answer from general knowledge.\n\n` +
          `Material:\n${citedBlock(sources)}\n\nQuestion: ${question}`,
      },
    ],
    700,
  )
}

/**
 * A saved prompt: the student's own instruction, applied to their own note or
 * material. It keeps the tutor's manners but follows their wording first.
 */
export function runCustomAction(
  provider: Provider,
  prompt: string,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    provider,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `The student saved this instruction for their Studydeck assistant:\n\n${prompt}\n\n` +
          `Follow it using only the material below. If the material cannot answer it, say so plainly and name what is missing instead of inventing anything. ` +
          `Keep to the format the instruction asks for.\n\n` +
          `Material:\n${buildSourceBlock(sources)}`,
      },
    ],
    900,
  )
}

/** A transformation: turn material into practice questions. */
export function practiceQuestions(
  provider: Provider,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    provider,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `Write 5 exam-style practice questions from the material below, easiest first. Number them 1 to 5. ` +
          `After each question, put the answer on the next line beginning "Answer: ". Use only what the material says.\n\n` +
          buildSourceBlock(sources),
      },
    ],
    900,
  )
}

/**
 * Revision covers a topic, not one chapter, so each item gets a share of the
 * prompt: a subject with several chapters stays represented instead of the
 * first one filling the budget.
 */
function revisionBlock(sources: NoteSource[]): string {
  const budget = 14_000
  const share = Math.max(900, Math.floor(budget / Math.max(sources.length, 1)))
  const parts: string[] = []
  let left = budget
  for (const [index, source] of sources.entries()) {
    const text = source.body.slice(0, Math.min(share, left))
    if (!text.trim()) continue
    left -= text.length
    parts.push(`[${index + 1}] ${source.title}\n${text}`)
    if (left <= 0) break
  }
  return parts.join('\n\n')
}

/** Revision cards: strict Q/A pairs the app can flip through. */
export function revisionCards(
  provider: Provider,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    provider,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `Write revision flashcards from the material below: 6 to 12 cards covering the key facts, definitions and steps. ` +
          `If it covers more than one chapter or topic, spread the cards across all of them instead of dwelling on the first. ` +
          `Use exactly this format, one card after another, with a blank line between cards and nothing else:\n` +
          `Q: <one short question>\nA: <the answer, one or two sentences>\n\n` +
          `Use only what the material says. No numbering, no headings and no commentary.\n\n` +
          revisionBlock(sources),
      },
    ],
    1_200,
  )
}

/** A slide outline: headings and a few bullets, one slide per --- line. */
export function revisionSlides(
  provider: Provider,
  sources: NoteSource[],
  context = '',
): Promise<string> {
  return complete(
    provider,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `Turn the material below into a short presentation for revising it: 6 to 10 slides. ` +
          `If it covers more than one chapter or topic, give each of them at least one slide. ` +
          `Start each slide with a heading line beginning "# " and add at most four "- " bullets of a few words each. ` +
          `Separate slides with a line containing only ---. ` +
          `Begin with a title slide, give one idea per slide, and end with a "# Check yourself" slide of three questions. ` +
          `Use only what the material says. No other text.\n\n` +
          revisionBlock(sources),
      },
    ],
    1_400,
  )
}

export type DayBriefInput = {
  school: { title: string; topic: string }[]
  coaching: { attending: boolean; topic: string } | null
  homework: { title: string; minutes: number }[]
  planned: { title: string; minutes: number }[]
  backlog: {
    overdueTasks: number
    chaptersLeft: number
    nearestExamInDays: number | null
  }
}

/**
 * The end-of-day brief: it sees what was taught, what was set and what the
 * evening plan already contains, so its advice is about this evening rather
 * than study in general.
 */
export function dayBrief(
  provider: Provider,
  day: DayBriefInput,
  context = '',
): Promise<string> {
  const school = day.school.length
    ? day.school
        .map((item) => `- ${item.title}: ${item.topic || 'no topic written down'}`)
        .join('\n')
    : '- No school today'
  const coaching = day.coaching
    ? day.coaching.attending
      ? `- Attended: ${day.coaching.topic || 'no topic written down'}`
      : '- Did not go'
    : '- No coaching set up'
  const homework = day.homework.length
    ? day.homework
        .map((item) => `- ${item.title} (${item.minutes} min)`)
        .join('\n')
    : '- No homework named'
  const planned = day.planned.length
    ? day.planned
        .map((item) => `- ${item.title} (${item.minutes} min)`)
        .join('\n')
    : '- Nothing planned yet'
  const backlog = `${day.backlog.overdueTasks} overdue task(s), ${day.backlog.chaptersLeft} chapters not yet ticked${
    day.backlog.nearestExamInDays === null
      ? ', no exam date set'
      : `, nearest exam in ${day.backlog.nearestExamInDays} day(s)`
  }`

  return complete(
    provider,
    [
      { role: 'system', content: systemPrompt(context) },
      {
        role: 'user',
        content:
          `Write tonight’s brief for this study day. Use 3 to 5 short "- " bullets: what to start with and why, which topic from today deserves ten minutes of review, and one honest note about the backlog or the nearest exam. ` +
          `Then a final line "Worth checking:" followed by two short questions the student should ask themselves about what they did not fully understand today. ` +
          `Do not repeat the plan block by block, and do not invent topics.\n\n` +
          `School:\n${school}\n\nCoaching:\n${coaching}\n\nHomework:\n${homework}\n\nEvening plan:\n${planned}\n\nBacklog: ${backlog}`,
      },
    ],
    600,
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
