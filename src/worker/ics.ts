import type { Entry } from '../shared/types'

const MINUTES_PER_DAY = 24 * 60
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

const pad = (value: number) => String(value).padStart(2, '0')

/** iCalendar TEXT escaping: backslash, newline, comma and semicolon. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[\r\n]+/g, '\\n')
    .replace(/([,;])/g, '\\$1')
}

/** A floating local time, so the calendar keeps the student's own clock. */
function localStamp(base: Date, minutes: number): string {
  const date = new Date(base)
  date.setDate(date.getDate() + Math.floor(minutes / MINUTES_PER_DAY))
  const rest = minutes % MINUTES_PER_DAY
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(
    Math.floor(rest / 60),
  )}${pad(rest % 60)}00`
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The weekly timetable and revision plan as a calendar file. Weekly classes
 * repeat for 20 weeks from their next occurrence; revision blocks land on the
 * date they were planned for. Breaks are left out: they are not appointments.
 */
export function timetableFile(entries: Entry[], now = new Date()): string {
  const utcStamp = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekday = (midnight.getDay() + 6) % 7
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Studydeck//Timetable//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Studydeck',
  ]

  for (const entry of entries) {
    if (entry.kind === 'break') continue
    let day: Date | null
    let rule = ''
    if (entry.plan === 'intensive') {
      day = parseDate(entry.date)
      if (!day) continue
    } else {
      day = new Date(midnight)
      day.setDate(day.getDate() + ((entry.day - weekday + 7) % 7))
      rule = 'RRULE:FREQ=WEEKLY;COUNT=20'
    }
    const event = [
      'BEGIN:VEVENT',
      `UID:${entry.id}@studydeck`,
      `DTSTAMP:${utcStamp}`,
      `DTSTART:${localStamp(day, entry.startMin)}`,
      `DTEND:${localStamp(day, entry.endMin)}`,
      `SUMMARY:${escapeText(entry.title)}`,
    ]
    if (rule) event.push(rule)
    if (entry.room) event.push(`LOCATION:${escapeText(entry.room)}`)
    if (entry.kind === 'exam') event.push('CATEGORIES:Exam')
    event.push('END:VEVENT')
    lines.push(...event)
  }

  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

/** Used by the route to name the file after the day it was taken. */
export function calendarFileName(now = new Date()): string {
  return `studydeck-${now.toISOString().slice(0, 10)}.ics`
}
