export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const DAY_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

export function isoOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function todayISO(): string {
  return isoOf(new Date())
}

export function fromISO(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

export function addDays(iso: string, days: number): string {
  const date = fromISO(iso)
  date.setDate(date.getDate() + days)
  return isoOf(date)
}

/** Monday = 0 … Sunday = 6. */
export function dayIndexOf(iso: string): number {
  return (fromISO(iso).getDay() + 6) % 7
}

export function weekStartOf(iso: string): string {
  return addDays(iso, -dayIndexOf(iso))
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (fromISO(to).getTime() - fromISO(from).getTime()) / 86_400_000,
  )
}

export function minutesNow(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

export function fmtTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24
  const mins = minutes % 60
  const suffix = hours >= 12 ? 'pm' : 'am'
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour}:${String(mins).padStart(2, '0')}${suffix}`
}

export function fmtDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (!hours) return `${mins} min`
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

export function toTimeValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`
}

export function parseTimeValue(value: string): number {
  const [hours, mins] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (mins ?? 0)
}

export function fmtDate(iso: string): string {
  if (!iso) return ''
  return fromISO(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function fmtDateLong(iso: string): string {
  return fromISO(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function dueLabel(iso: string): string {
  if (!iso) return 'No date'
  const diff = daysBetween(todayISO(), iso)
  if (diff < -1) return `${-diff} days overdue`
  if (diff === -1) return 'Yesterday'
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 7) return `In ${diff} days`
  return fmtDate(iso)
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
