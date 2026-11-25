/**
 * Spaced repetition for the flashcards the library already makes. The schedule
 * is deliberately small and readable: four answers, an ease that drifts with
 * how well you knew a card, and a due date counted in whole days.
 */
import type { ReviewResult } from './types'

export const REVIEW_RESULTS: ReviewResult[] = ['again', 'hard', 'good', 'easy']

export const NEW_EASE = 250
export const MIN_EASE = 130
export const MAX_EASE = 320
export const MAX_INTERVAL = 365

/** What the schedule remembers about one card. */
export type ReviewState = {
  intervalDays: number
  ease: number
  lapses: number
  dueDate: string
}

/** A stored schedule, or nothing for a card that has never been answered. */
export type ReviewMemory = Pick<ReviewState, 'intervalDays' | 'ease' | 'lapses'>

/** Adds whole days to a YYYY-MM-DD date, in UTC so the day never shifts. */
export function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`)
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

function intervalFor(
  intervalDays: number,
  ease: number,
  result: ReviewResult,
): number {
  if (result === 'again') return 0
  if (intervalDays === 0)
    return result === 'easy' ? 3 : 1
  const grown =
    result === 'hard'
      ? intervalDays * 1.2
      : result === 'easy'
        ? (intervalDays * ease * 1.3) / 100
        : (intervalDays * ease) / 100
  const floor = result === 'hard' ? 1 : intervalDays + 1
  return Math.min(MAX_INTERVAL, Math.max(floor, Math.round(grown)))
}

function easeFor(ease: number, result: ReviewResult): number {
  if (result === 'again') return Math.max(MIN_EASE, ease - 20)
  if (result === 'hard') return Math.max(MIN_EASE, ease - 15)
  if (result === 'easy') return Math.min(MAX_EASE, ease + 15)
  return ease
}

/** The next due date for a card, given what we last knew about it. */
export function nextReview(
  memory: ReviewMemory | null,
  result: ReviewResult,
  today: string,
): ReviewState {
  const intervalDays = memory?.intervalDays ?? 0
  const ease = memory?.ease ?? NEW_EASE
  const lapses = memory?.lapses ?? 0
  const nextInterval = intervalFor(intervalDays, ease, result)
  return {
    intervalDays: nextInterval,
    ease: easeFor(ease, result),
    lapses: result === 'again' ? lapses + 1 : lapses,
    // A card you got wrong comes back tomorrow; the others wait their interval.
    dueDate: addDays(today, result === 'again' ? 1 : nextInterval),
  }
}

/** "tomorrow", "in 3 days" — the hint under each answer button. */
export function nextGap(
  memory: ReviewMemory | null,
  result: ReviewResult,
): string {
  if (result === 'again') return 'tomorrow'
  const days = intervalFor(memory?.intervalDays ?? 0, memory?.ease ?? NEW_EASE, result)
  if (days <= 1) return 'in 1 day'
  return `in ${days} days`
}
