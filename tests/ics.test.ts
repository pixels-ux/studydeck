import { expect, test } from 'bun:test'
import type { Entry } from '../src/shared/types'
import { timetableFile } from '../src/worker/ics'

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  subjectId: null,
  title: 'Physics',
  kind: 'class',
  day: 0,
  startMin: 480,
  endMin: 525,
  room: '',
  plan: 'regular',
  date: '',
  ...over,
})

// 22 November 2026 is a Sunday, so the next Monday is the 23rd.
const sunday = new Date(2026, 10, 22, 9, 0)

test('weekly classes start on their next occurrence and repeat', () => {
  const file = timetableFile([entry({ room: 'Lab 2' })], sunday)
  expect(file.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  expect(file.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  expect(file).toContain('DTSTART:20261123T080000')
  expect(file).toContain('DTEND:20261123T084500')
  expect(file).toContain('RRULE:FREQ=WEEKLY;COUNT=20')
  expect(file).toContain('LOCATION:Lab 2')
})

test('revision blocks keep their own date and breaks are left out', () => {
  const file = timetableFile(
    [
      entry({
        id: 'e2',
        plan: 'intensive',
        kind: 'study',
        date: '2026-12-01',
        day: 1,
        startMin: 960,
        endMin: 1010,
        title: 'Physics revision',
      }),
      entry({ id: 'e3', kind: 'break', title: 'Break' }),
    ],
    sunday,
  )
  expect(file).toContain('DTSTART:20261201T160000')
  expect(file).not.toContain('RRULE')
  expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  expect(file).not.toContain('Break')
})

test('titles are escaped and blocks can run past midnight', () => {
  const file = timetableFile(
    [entry({ title: 'Maths, part 2; test', startMin: 1380, endMin: 1440 })],
    sunday,
  )
  expect(file).toContain('SUMMARY:Maths\\, part 2\\; test')
  expect(file).toContain('DTSTART:20261123T230000')
  // 1440 minutes from midnight is the next day, not hour 24.
  expect(file).toContain('DTEND:20261124T000000')
})
