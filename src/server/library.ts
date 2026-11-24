/**
 * Turning a student's material into text an AI answer can be grounded in.
 *
 * There are no paid models and no vector service: a local app should not need a
 * second account just to find the right page. Each source is cut into
 * paragraphs, and a question picks the paragraphs that share the most (rare)
 * words with it.
 *
 * Finding by meaning is done by a small distributional model built from the
 * material itself: every word starts with a fixed random vector, words that
 * keep appearing in the same paragraphs are pulled towards each other over a
 * couple of passes, and a paragraph is the sum of its words. Nothing leaves
 * the machine, there is no model to download, and the index is rebuilt only
 * when the material changes.
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
  /** True when the paragraph shares no word with the query. */
  byMeaning: boolean
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

/**
 * English enough for school notes: plurals and the usual verb endings, so
 * "sugars" and "sugar" count as the same word. Nothing is looked up anywhere.
 */
function stem(word: string): string {
  if (word.length <= 4) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('sses')) return word.slice(0, -2)
  // Not every -s is a plural: photosynthesis, nucleus and physics are not.
  if (word.endsWith('s') && !/(ss|us|is|ics)$/.test(word)) return word.slice(0, -1)
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2)
  return word
}

/** Subject words of three letters or more, lowercased and de-duplicated. */
export function terms(text: string): string[] {
  const found = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
  return [
    ...new Set(found.filter((word) => !STOP_WORDS.has(word)).map(stem)),
  ]
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

/* --- Meaning: a small model of the material, with no model to download --- */

const MEANING_DIMS = 128
/** Below this, a paragraph is only vaguely near the question. */
const MEANING_FLOOR = 0.2
/** How much a meaning-only match counts next to a shared word. */
const MEANING_WEIGHT = 0.75

/** The paragraphs of one notebook, each turned into a meaning vector. */
export type SemanticIndex = {
  vectors: Float32Array[]
  terms: Map<string, Float32Array>
}

function hashOf(text: string): number {
  let hash = 2166136261
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** A fixed sparse vector per word: two words only meet through shared context. */
function seedOf(term: string): Float32Array {
  const vector = new Float32Array(MEANING_DIMS)
  let state = hashOf(term) || 1
  for (let slot = 0; slot < 3; slot += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const at = state % MEANING_DIMS
    vector[at]! += (state & 0x20000) === 0 ? 1 : -1
  }
  return vector
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (let at = 0; at < vector.length; at += 1) sum += vector[at]! ** 2
  const length = Math.sqrt(sum)
  if (!length) return vector
  for (let at = 0; at < vector.length; at += 1) vector[at]! /= length
  return vector
}

function addScaled(
  target: Float32Array,
  source: Float32Array,
  scale: number,
): void {
  for (let at = 0; at < target.length; at += 1)
    target[at]! += source[at]! * scale
}

function similarity(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let at = 0; at < a.length; at += 1) sum += a[at]! * b[at]!
  return sum
}

/**
 * Words that keep appearing together are pulled towards each other, so a
 * paragraph about glucose answers a question about sugar once the material has
 * linked the two. The link is learned per notebook, from that student's own
 * material, and is a couple of passes away from a plain word count.
 */
export function buildSemanticIndex(chunks: SourceChunk[]): SemanticIndex {
  const counts = chunks.map((chunk) => {
    const lower = chunk.text.toLowerCase()
    const found = new Map<string, number>()
    for (const term of terms(lower))
      found.set(term, 1 + occurrences(lower, term))
    return found
  })

  const frequency = new Map<string, number>()
  for (const found of counts)
    for (const term of found.keys())
      frequency.set(term, (frequency.get(term) ?? 0) + 1)
  const idf = (term: string) => Math.log(1 + chunks.length / (frequency.get(term) ?? 1))

  // What each paragraph is about, as one bag-of-words vector.
  const contexts = counts.map((found) => {
    const vector = new Float32Array(MEANING_DIMS)
    for (const [term, amount] of found)
      addScaled(vector, seedOf(term), amount * idf(term))
    return normalize(vector)
  })

  const places = new Map<string, number[]>()
  counts.forEach((found, at) => {
    for (const term of found.keys()) {
      const seen = places.get(term)
      if (seen) seen.push(at)
      else places.set(term, [at])
    }
  })

  const words = new Map<string, Float32Array>()
  for (const [term, at] of places) {
    const vector = seedOf(term)
    for (const place of at) addScaled(vector, contexts[place]!, 1)
    words.set(term, normalize(vector))
  }

  const vectors = counts.map((found) => {
    const vector = new Float32Array(MEANING_DIMS)
    for (const [term, amount] of found) {
      const word = words.get(term)
      if (word) addScaled(vector, word, amount * idf(term))
    }
    return normalize(vector)
  })

  return { vectors, terms: words }
}

/** A direction in the material's meaning space, or null for unknown words. */
function askVector(index: SemanticIndex, query: string): Float32Array | null {
  const vector = new Float32Array(MEANING_DIMS)
  let known = 0
  for (const term of terms(query)) {
    const word = index.terms.get(term)
    if (!word) continue
    known += 1
    addScaled(vector, word, 1)
  }
  return known ? normalize(vector) : null
}

/**
 * Search the material by words and by meaning, best paragraph per source.
 * Pass the index built for these chunks to let a paragraph answer a question
 * that uses different words for the same idea.
 */
export function search(
  chunks: SourceChunk[],
  query: string,
  limit = 8,
  index?: SemanticIndex | null,
): SearchHit[] {
  const scored = scoreChunks(chunks, query)
  const asked = index ? askVector(index, query) : null
  const best = scored.reduce((top, item) => Math.max(top, item.score), 0)

  const seen = new Set<string>()
  const hits: SearchHit[] = []
  const ranked = scored
    .map((item, position) => {
      const meaning = asked ? similarity(asked, index!.vectors[position]!) : 0
      return {
        ...item,
        position,
        meaning,
        rank: (best ? item.score / best : 0) + Math.max(0, meaning) * MEANING_WEIGHT,
      }
    })
    .filter((item) => item.score > 0 || item.meaning >= MEANING_FLOOR)
    .sort((a, b) => b.rank - a.rank || a.position - b.position)

  for (const item of ranked) {
    if (seen.has(item.chunk.sourceId)) continue
    seen.add(item.chunk.sourceId)
    hits.push({
      sourceId: item.chunk.sourceId,
      sourceTitle: item.chunk.sourceTitle,
      snippet: snippetFor(item.chunk.text, item.matched),
      byMeaning: item.matched.length === 0,
    })
    if (hits.length >= limit) break
  }
  return hits
}
