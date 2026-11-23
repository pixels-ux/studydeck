/**
 * Turning a student's material into text an AI answer can be grounded in.
 *
 * There are no embeddings and no vector store: a local app should not need a
 * second paid model just to find the right page. Instead each source is cut
 * into paragraphs, and a question picks the paragraphs that share the most
 * (rare) words with it. For a chapter of notes that finds the right passage
 * about as well as a vector index, and the student can read exactly which
 * source every answer came from.
 */

export const MAX_SOURCE_CHARS = 20_000

const CHUNK_CHARS = 1_400
const MAX_PROMPT_CHARS = 12_000
const MAX_CHUNKS_PER_SOURCE = 3
const MAX_CITED_SOURCES = 5

export type SourceChunk = {
  sourceId: string
  sourceTitle: string
  text: string
}

export type CitedSource = {
  /** The number the model sees and the answer cites, starting at 1. */
  index: number
  sourceId: string
  sourceTitle: string
  text: string
}

export type SearchHit = {
  sourceId: string
  sourceTitle: string
  snippet: string
}

/** Words that carry no subject meaning, so matching on them would mislead. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'from',
  'that', 'this', 'these', 'those', 'was', 'were', 'has', 'have', 'had',
  'can', 'could', 'would', 'should', 'what', 'when', 'where', 'which', 'who',
  'why', 'how', 'does', 'did', 'doing', 'done', 'about', 'into', 'than',
  'then', 'them', 'they', 'their', 'there', 'here', 'also', 'its', "it's",
  'explain', 'describe', 'define', 'write', 'tell', 'give', 'list', 'state',
  'short', 'answer', 'question', 'please', 'using', 'use', 'used', 'between',
  'because', 'been', 'being', 'other', 'some', 'such', 'only', 'more', 'most',
])

/** Subject words of three letters or more, lowercased and de-duplicated. */
export function terms(text: string): string[] {
  const found = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
  return [...new Set(found.filter((word) => !STOP_WORDS.has(word)))]
}

/** Split on blank lines, then pack paragraphs up to one readable chunk. */
export function chunkSource(source: {
  id: string
  title: string
  body: string
}): SourceChunk[] {
  const paragraphs = source.body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)

  const pieces: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      if (current) {
        pieces.push(current)
        current = ''
      }
      for (let start = 0; start < paragraph.length; start += CHUNK_CHARS)
        pieces.push(paragraph.slice(start, start + CHUNK_CHARS))
      continue
    }
    if ((current + '\n\n' + paragraph).length > CHUNK_CHARS && current) {
      pieces.push(current)
      current = paragraph
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
  }
  if (current) pieces.push(current)

  return pieces.map((text) => ({
    sourceId: source.id,
    sourceTitle: source.title,
    text,
  }))
}

/** How often a term appears, counted generously enough to matter, not dominate. */
function occurrences(text: string, term: string): number {
  let count = 0
  let at = text.indexOf(term)
  while (at !== -1 && count < 4) {
    count += 1
    at = text.indexOf(term, at + term.length)
  }
  return count
}

function scoreChunks(
  chunks: SourceChunk[],
  question: string,
): { chunk: SourceChunk; score: number; matched: string[] }[] {
  const asked = terms(question)
  if (!asked.length || !chunks.length)
    return chunks.map((chunk) => ({ chunk, score: 0, matched: [] }))

  // A word that appears in every paragraph says nothing about which is relevant.
  const documentFrequency = new Map<string, number>()
  for (const chunk of chunks) {
    const text = chunk.text.toLowerCase()
    for (const term of asked)
      if (text.includes(term))
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  }

  return chunks.map((chunk) => {
    const text = chunk.text.toLowerCase()
    const matched: string[] = []
    let score = 0
    for (const term of asked) {
      const hits = occurrences(text, term)
      if (!hits) continue
      matched.push(term)
      const frequency = documentFrequency.get(term) ?? 1
      score += hits * Math.log(1 + chunks.length / frequency)
    }
    return { chunk, score, matched }
  })
}

/**
 * The passages to send with a question, numbered by source so a citation like
 * [2] always means the same piece of material in the answer and in the UI.
 */
export function retrieve(
  chunks: SourceChunk[],
  question: string,
  limit = MAX_CITED_SOURCES,
): CitedSource[] {
  const scored = scoreChunks(chunks, question)
  const ranked = scored
    .map((item, position) => ({ ...item, position }))
    .sort((a, b) => b.score - a.score || a.position - b.position)

  const bySource = new Map<string, { title: string; parts: string[] }>()
  for (const item of ranked) {
    if (item.score <= 0) break
    const existing = bySource.get(item.chunk.sourceId)
    if (existing && existing.parts.length >= MAX_CHUNKS_PER_SOURCE) continue
    if (!existing)
      bySource.set(item.chunk.sourceId, {
        title: item.chunk.sourceTitle,
        parts: [item.chunk.text],
      })
    else existing.parts.push(item.chunk.text)
    if (bySource.size >= limit) break
  }

  // Nothing shared the question's words: hand over the opening of the material
  // so the model can still answer "that is not covered" with evidence.
  if (!bySource.size) {
    for (const chunk of chunks) {
      if (bySource.size >= 3) break
      if (!bySource.has(chunk.sourceId))
        bySource.set(chunk.sourceId, {
          title: chunk.sourceTitle,
          parts: [chunk.text],
        })
    }
  }

  const cited: CitedSource[] = []
  let budget = MAX_PROMPT_CHARS
  for (const [sourceId, source] of bySource) {
    const text = source.parts.join('\n\n').slice(0, budget)
    if (!text) continue
    budget -= text.length
    cited.push({
      index: cited.length + 1,
      sourceId,
      sourceTitle: source.title,
      text,
    })
    if (budget <= 0) break
  }
  return cited
}

/** The paragraph or two around the first match, for the search panel. */
function snippetFor(text: string, matched: string[]): string {
  const lower = text.toLowerCase()
  const at = matched.length
    ? Math.min(
        ...matched.map((term) => {
          const found = lower.indexOf(term)
          return found === -1 ? Number.POSITIVE_INFINITY : found
        }),
      )
    : 0
  const start = Math.max(0, (Number.isFinite(at) ? at : 0) - 90)
  const end = Math.min(text.length, start + 260)
  const piece = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`
}

/** Full-text search across the material, best paragraph per source. */
export function search(
  chunks: SourceChunk[],
  query: string,
  limit = 8,
): SearchHit[] {
  const scored = scoreChunks(chunks, query)
    .map((item, position) => ({ ...item, position }))
    .sort((a, b) => b.score - a.score || a.position - b.position)

  const seen = new Set<string>()
  const hits: SearchHit[] = []
  for (const item of scored) {
    if (item.score <= 0) break
    if (seen.has(item.chunk.sourceId)) continue
    seen.add(item.chunk.sourceId)
    hits.push({
      sourceId: item.chunk.sourceId,
      sourceTitle: item.chunk.sourceTitle,
      snippet: snippetFor(item.chunk.text, item.matched),
    })
    if (hits.length >= limit) break
  }
  return hits
}
