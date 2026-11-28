import { expect, test } from 'bun:test'
import type { Entry, EntryKind, Plan } from '../src/shared/types'
import { clockText, firstSession, tonightBlocks } from '../src/client/session.ts'

const DATE = '2026-11-28'

function block(
  id: string,
  startMin: number,
  endMin: number,
  values: { kind?: EntryKind; plan?: Plan; date?: string } = {},
): Entry {
  return {
    id,
    subjectId: null,
    title: id,
    kind: values.kind ?? 'study',
    day: 0,
    startMin,
    endMin,
    room: '',
    plan: values.plan ?? 'intensive',
    date: values.date ?? DATE,
  }
}

test('tonight holds only the saved plan for the day, in order', () => {
  const entries = [
    block('tomorrow', 60, 90, { date: '2026-11-29' }),
    block('evening', 120, 150),
    block('class', 30, 45, { plan: 'regular' }),
    block('opening', 90, 120),
  ]
  expect(tonightBlocks(entries, DATE).map((entry) => entry.id)).toEqual([
    'opening',
    'evening',
  ])
  expect(tonightBlocks(entries, '2026-11-30')).toEqual([])
})

test('the timer opens on the next study block, skipping breaks', () => {
  const blocks = [
    block('review', 18 * 60, 18 * 60 + 20),
    block('break', 18 * 60 + 20, 18 * 60 + 30, { kind: 'break' }),
    block('homework', 18 * 60 + 30, 19 * 60 + 15),
  ]
  // 5pm: the first block has not started yet.
  expect(firstSession(blocks, 17 * 60)?.id).toBe('review')
  // 6:25pm: the review is done, so the timer moves past the break to the next
  // study block.
  expect(firstSession(blocks, 18 * 60 + 25)?.id).toBe('homework')
  // 11pm: the evening is over; it falls back to the first block rather than
  // starting on a break.
  expect(firstSession(blocks, 23 * 60)?.id).toBe('review')
  // A plan of breaks only has nothing else to offer.
  expect(
    firstSession([block('break', 18 * 60, 18 * 60 + 10, { kind: 'break' })], 8 * 60)
      ?.id,
  ).toBe('break')
  expect(firstSession([], 8 * 60)).toBeNull()
})

test('a countdown reads as mm:ss, and as h:mm:ss past the hour', () => {
  expect(clockText(0)).toBe('00:00')
  expect(clockText(65)).toBe('01:05')
  expect(clockText(20 * 60)).toBe('20:00')
  expect(clockText(3600)).toBe('1:00:00')
  expect(clockText(3725)).toBe('1:02:05')
  expect(clockText(59.6)).toBe('01:00')
  expect(clockText(-4)).toBe('00:00')
})
