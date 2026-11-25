/** Reading the revision material the library saves as notes. */

export type RevisionCard = { question: string; answer: string }

/** One slide: a heading and the bullets under it. */
export type RevisionSlide = { heading: string; lines: string[] }

export type RevisionKind = 'cards' | 'slides'

/** Only notes the library made are shown with a Revise button. */
export function revisionKindOf(title: string): RevisionKind | null {
  if (title.startsWith('Flashcards ·')) return 'cards'
  if (title.startsWith('Slides ·')) return 'slides'
  return null
}

/**
 * A card's handle across reloads and edits: the question, not its place, so
 * inserting a card above it does not move its review history to another card.
 */
export function cardKey(question: string): string {
  const text = question.toLowerCase().replace(/\s+/g, ' ').trim()
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Cards are written as Q:/A: pairs; anything else is ignored. */
export function parseCards(text: string): RevisionCard[] {
  const cards: RevisionCard[] = []
  let question = ''
  let answer: string[] = []

  const flush = () => {
    if (question && answer.length)
      cards.push({
        question,
        answer: answer.join(' ').replace(/\s+/g, ' ').trim(),
      })
    question = ''
    answer = []
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*/g, '').trim()
    if (!line) continue
    const asked = /^(?:Q|Question)\s*\d*\s*[:.)-]\s*(.+)$/i.exec(line)
    if (asked) {
      flush()
      question = asked[1]!.trim()
      continue
    }
    const replied = /^(?:A|Answer)\s*\d*\s*[:.)-]\s*(.+)$/i.exec(line)
    if (replied && question) {
      answer.push(replied[1]!.trim())
      continue
    }
    // A wrapped answer keeps its next lines.
    if (answer.length) answer.push(line)
  }
  flush()
  return cards
}

/** Slides are separated by a line of dashes, each led by a heading. */
export function parseSlides(text: string): RevisionSlide[] {
  const slides: RevisionSlide[] = []
  let current: string[] = []

  const flush = () => {
    const lines = current.map((line) => line.trim()).filter(Boolean)
    current = []
    if (!lines.length) return
    const heading = lines[0]!
      .replace(/^#{1,6}\s*/, '')
      .replace(/\*\*/g, '')
      .trim()
    if (!heading) return
    slides.push({
      heading,
      lines: lines
        .slice(1)
        .map((line) => line.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '').trim())
        .filter(Boolean),
    })
  }

  for (const raw of text.split(/\r?\n/)) {
    if (/^-{3,}$/.test(raw.trim())) {
      flush()
      continue
    }
    current.push(raw)
  }
  flush()
  return slides
}
