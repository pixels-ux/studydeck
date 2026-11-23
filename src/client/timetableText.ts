/**
 * The setup wizard asks for the school timetable as the student already knows
 * it: one period per line, a time range and a subject. Accepting text keeps the
 * form small and lets a timetable be pasted from anywhere, and parsing it is
 * small enough to test exactly.
 */

export type TimetablePeriod = {
  startMin: number
  endMin: number
  subjectName: string
}

export type TimetableParse = {
  periods: TimetablePeriod[]
  errors: string[]
}

function toMinutes(hours: number, minutes: number, meridiem?: string): number {
  let value = hours * 60 + minutes
  if (meridiem?.toLowerCase() === 'pm' && hours < 12) value += 12 * 60
  if (meridiem?.toLowerCase() === 'am' && hours === 12) value -= 12 * 60
  return value
}

/** `08:00-08:45 Mathematics`, `8:00 am – 8:45 am Maths`, `8 to 9 Science`. */
const LINE =
  /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s+(.+?)\s*$/i

export function parseTimetable(text: string): TimetableParse {
  const periods: TimetablePeriod[] = []
  const errors: string[] = []
  const lines = text.split('\n')
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const match = line.match(LINE)
    if (!match) {
      errors.push(`Line ${index + 1}: write it like “08:00-08:45 Mathematics”.`)
      return
    }
    const [, startHour, startMinute, startMeridiem, endHour, endMinute, endMeridiem, subject] =
      match
    const startMin = toMinutes(
      Number(startHour),
      Number(startMinute ?? 0),
      startMeridiem,
    )
    const endMin = toMinutes(Number(endHour), Number(endMinute ?? 0), endMeridiem)
    if (startMin < 0 || startMin > 1439 || endMin < 1 || endMin > 1440) {
      errors.push(`Line ${index + 1}: those times are outside a day.`)
      return
    }
    if (endMin <= startMin) {
      errors.push(`Line ${index + 1}: the period must finish after it starts.`)
      return
    }
    if (endMin - startMin < 10) {
      errors.push(`Line ${index + 1}: a period needs at least 10 minutes.`)
      return
    }
    const name = subject.trim()
    if (!name || name.length > 40) {
      errors.push(`Line ${index + 1}: give the period a subject of 40 characters or less.`)
      return
    }
    periods.push({ startMin, endMin, subjectName: name })
  })

  const sorted = [...periods].sort((a, b) => a.startMin - b.startMin)
  return { periods: sorted, errors }
}

const pad = (value: number) => String(value).padStart(2, '0')

export function formatTimetable(
  periods: { startMin: number; endMin: number; subjectName: string }[],
): string {
  return [...periods]
    .sort((a, b) => a.startMin - b.startMin)
    .map(
      (period) =>
        `${pad(Math.floor(period.startMin / 60))}:${pad(period.startMin % 60)}-${pad(
          Math.floor(period.endMin / 60),
        )}:${pad(period.endMin % 60)} ${period.subjectName}`,
    )
    .join('\n')
}

export const TIMETABLE_HINT =
  'One period per line, for example 08:00-08:45 Mathematics.'
