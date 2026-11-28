import { useEffect, useMemo, useState } from 'react'
import type { Entry } from '../shared/types'
import { fmtDuration, fmtTime, minutesNow, todayISO } from './dates'
import { clockText, firstSession, tonightBlocks } from './session'
import { useWorkspace } from './workspace'

/** Survives a trip to another tab, so a break does not reset the clock. */
const STORE = 'studydeck.session.v1'

type Session = {
  blockId: string
  /** When the countdown ends, or null while paused. */
  endsAt: number | null
  remaining: number
}

const secondsOf = (block: Entry) => Math.max(0, block.endMin - block.startMin) * 60

function readStored(date: string, blocks: Entry[]): Session | null {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session> & { date?: string }
    if (
      parsed.date !== date ||
      typeof parsed.blockId !== 'string' ||
      !blocks.some((block) => block.id === parsed.blockId)
    )
      return null
    const endsAt = typeof parsed.endsAt === 'number' ? parsed.endsAt : null
    const remaining =
      endsAt !== null
        ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
        : Math.max(0, Math.round(Number(parsed.remaining) || 0))
    return {
      blockId: parsed.blockId,
      // A countdown that ran out while the page was closed is finished, not
      // silently restarted.
      endsAt: endsAt !== null && remaining > 0 ? endsAt : null,
      remaining,
    }
  } catch {
    return null
  }
}

export default function SessionTimer() {
  const { data } = useWorkspace()
  const today = todayISO()
  const blocks = useMemo(() => tonightBlocks(data.entries, today), [data.entries, today])
  const first = useMemo(() => firstSession(blocks, minutesNow()), [blocks])

  const [session, setSession] = useState<Session>(() => {
    const stored = readStored(today, blocks)
    if (stored) return stored
    if (!first) return { blockId: '', remaining: 0, endsAt: null }
    return { blockId: first.id, remaining: secondsOf(first), endsAt: null }
  })

  // A saved block can disappear when tonight's plan is rebuilt.
  useEffect(() => {
    if (!blocks.length || blocks.some((block) => block.id === session.blockId)) return
    const next = firstSession(blocks, minutesNow())
    if (!next) return
    setSession({ blockId: next.id, remaining: secondsOf(next), endsAt: null })
  }, [blocks, session.blockId])

  useEffect(() => {
    if (!session.blockId) return
    try {
      localStorage.setItem(STORE, JSON.stringify({ date: today, ...session }))
    } catch {
      // A browser that refuses storage still gets a working timer.
    }
  }, [session, today])

  // The countdown is measured from a timestamp, so a slow tab cannot drift.
  useEffect(() => {
    if (session.endsAt === null) return
    const endsAt = session.endsAt
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setSession((current) =>
        current.endsAt !== endsAt
          ? current
          : { ...current, remaining, endsAt: remaining > 0 ? endsAt : null },
      )
    }
    tick()
    const handle = window.setInterval(tick, 1000)
    return () => window.clearInterval(handle)
  }, [session.endsAt])

  if (!blocks.length || !first) return null

  const block = blocks.find((item) => item.id === session.blockId) ?? first
  const total = secondsOf(block)
  const running = session.endsAt !== null
  const finished = !running && session.remaining === 0
  const progress = total ? Math.min(100, Math.max(0, (1 - session.remaining / total) * 100)) : 0
  const now = blocks.find((item) => item.startMin <= minutesNow() && item.endMin > minutesNow())
  const studyMinutes = blocks
    .filter((item) => item.kind !== 'break')
    .reduce((sum, item) => sum + item.endMin - item.startMin, 0)

  const start = (seconds = session.remaining) =>
    setSession((current) => ({
      ...current,
      remaining: seconds,
      endsAt: Date.now() + seconds * 1000,
    }))

  const pause = () =>
    setSession((current) => ({
      ...current,
      endsAt: null,
      remaining:
        current.endsAt !== null
          ? Math.max(0, Math.ceil((current.endsAt - Date.now()) / 1000))
          : current.remaining,
    }))

  const choose = (entry: Entry) =>
    setSession({ blockId: entry.id, remaining: secondsOf(entry), endsAt: null })

  const nextBlock = () => {
    const index = blocks.findIndex((item) => item.id === block.id)
    choose(blocks[(index + 1) % blocks.length]!)
  }

  return (
    <section className="card session-card">
      <div className="card-head">
        <h3>Tonight’s session</h3>
        <span className="count">
          {fmtDuration(studyMinutes)} planned · {blocks.length} block
          {blocks.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="session-body">
        <div className="session-now">
          <p className="eyebrow">
            {finished
              ? 'Time’s up'
              : running
                ? 'Running'
                : block.kind === 'break'
                  ? 'Break'
                  : 'Study block'}
          </p>
          <p className="session-title">
            {block.title}
            {now?.id === block.id ? <span className="session-badge">now</span> : null}
          </p>
          <p className="session-clock" role="timer">
            {clockText(session.remaining)}
          </p>
          <p className="muted small">
            {fmtTime(block.startMin)} – {fmtTime(block.endMin)} ·{' '}
            {fmtDuration(block.endMin - block.startMin)}
            {finished ? ' · done' : ''}
          </p>
          <div className="session-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => (running ? pause() : start(session.remaining > 0 ? session.remaining : total))}
            >
              {running ? 'Pause' : finished ? 'Start again' : session.remaining < total ? 'Resume' : 'Start'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                setSession((current) => ({
                  ...current,
                  remaining: current.remaining + 300,
                  endsAt: current.endsAt === null ? null : current.endsAt + 300_000,
                }))
              }
            >
              +5 min
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setSession({ ...session, remaining: total, endsAt: null })}
            >
              Reset
            </button>
            <button type="button" className="btn ghost" onClick={nextBlock}>
              Next block
            </button>
          </div>
        </div>
        <ol className="session-blocks">
          {blocks.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={entry.id === block.id ? 'session-block active' : 'session-block'}
                onClick={() => choose(entry)}
              >
                <span className="session-block-time">{fmtTime(entry.startMin)}</span>
                <span className="session-block-title">
                  {entry.kind === 'break' ? 'Break' : entry.title}
                </span>
                <span className="muted small">
                  {fmtDuration(entry.endMin - entry.startMin)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
