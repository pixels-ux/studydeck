import type { RevisionCard } from '../shared/revision'

/**
 * A deck as Anki's "Basic" note type imports it: one quoted row per card, with
 * the question first and the answer second.
 */
export function toAnkiCsv(cards: RevisionCard[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  return cards
    .map((card) => `${quote(card.question)},${quote(card.answer)}`)
    .join('\n')
}

/** "Flashcards · Light" becomes "light-anki.csv". */
export function deckFileName(title: string): string {
  const name = title
    .replace(/^Flashcards · /, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${name || 'studydeck'}-anki.csv`
}
