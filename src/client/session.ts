/**
 * The timer on Today follows the plan the day check-in already saved, so a
 * study block can be run from the page it was planned on.
 */
import type { Entry } from '../shared/types'

/** Tonight's blocks, in the order the evening runs. */
export function tonightBlocks(entries: Entry[], date: string): Entry[] {
  return entries
    .filter((entry) => entry.plan === 'intensive' && entry.date === date)
    .sort((a, b) => a.startMin - b.startMin)
}

/**
 * The block a fresh timer should sit on: the next study block still to come,
 * then the first study block, then whatever is left (a plan of breaks only).
 */
export function firstSession(
  blocks: Entry[],
  minutesNow: number,
): Entry | null {
  const study = blocks.filter((block) => block.kind !== 'break')
  return (
    study.find((block) => block.endMin > minutesNow) ??
    study[0] ??
    blocks[0] ??
    null
  )
}

/** A countdown as mm:ss, and h:mm:ss once it passes the hour. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}
