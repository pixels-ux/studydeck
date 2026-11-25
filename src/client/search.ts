import { unitsFor } from '../shared/curriculum'
import type { WorkspaceData } from '../shared/types'

/**
 * One search over everything the notebook already has in memory. Notes and
 * material arrive with the workspace, so nothing is sent to the server and
 * results keep up with typing.
 */

export type SearchKind = 'note' | 'material' | 'task' | 'chapter' | 'notebook'

export type SearchHit = {
  kind: SearchKind
  id: string
  title: string
  /** Where it lives: its subject, its due date, its book. */
  detail: string
  snippet: string
  score: number
}

export const SEARCH_KINDS: { kind: SearchKind; label: string }[] = [
  { kind: 'note', label: 'Notes' },
  { kind: 'material', label: 'Material' },
  { kind: 'task', label: 'Work' },
  { kind: 'chapter', label: 'Chapters' },
  { kind: 'notebook', label: 'Notebooks' },
]

const KIND_ORDER: Record<SearchKind, number> = {
  note: 0,
  material: 1,
  task: 2,
  chapter: 3,
  notebook: 4,
}

/** A few words either side of the match, so a hit reads like its page. */
export function snippetOf(text: string, query: string, width = 120): string {
  const lower = text.toLowerCase()
  const at = lower.indexOf(query.toLowerCase())
  if (at < 0) return text.replace(/\s+/g, ' ').slice(0, width).trim()
  const start = Math.max(0, at - 45)
  const end = Math.min(text.length, at + query.length + 65)
  const body = text
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim()
  return `${start ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

/** A title match beats a mention in the body; a word start beats the middle. */
function rank(title: string, body: string, query: string): number {
  const inTitle = title.toLowerCase()
  if (inTitle === query) return 140
  if (inTitle.startsWith(query)) return 110
  if (inTitle.includes(query)) return 80
  const inBody = body.toLowerCase()
  const at = inBody.indexOf(query)
  if (at < 0) return 0
  const boundary = at === 0 || !/[a-z0-9]/.test(inBody[at - 1] ?? '')
  return boundary ? 45 : 25
}

export function searchEverything(
  data: WorkspaceData,
  raw: string,
  perKind = 4,
): SearchHit[] {
  const query = raw.trim().toLowerCase()
  if (query.length < 2) return []

  const subjectName = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.name ?? 'General'
  const hits: SearchHit[] = []

  for (const note of data.notes) {
    const score = rank(note.title, note.body, query)
    if (!score) continue
    hits.push({
      kind: 'note',
      id: note.id,
      title: note.title,
      detail: `${subjectName(note.subjectId)} · note`,
      snippet: snippetOf(note.body, query),
      score,
    })
  }

  for (const source of data.sources) {
    const score = rank(source.title, source.body, query)
    if (!score) continue
    hits.push({
      kind: 'material',
      id: source.id,
      title: source.title,
      detail: `${subjectName(source.subjectId)} · material`,
      snippet: snippetOf(source.body, query),
      score,
    })
  }

  for (const task of data.tasks) {
    const score = rank(task.title, task.details, query)
    if (!score) continue
    const bits = [subjectName(task.subjectId)]
    if (task.dueDate) bits.push(`due ${task.dueDate}`)
    if (task.done) bits.push('done')
    hits.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      detail: bits.join(' · '),
      snippet: task.details ? snippetOf(task.details, query, 100) : '',
      score,
    })
  }

  const covered = new Set(
    data.syllabus.map((tick) => `${tick.subjectId}::${tick.chapter}`),
  )
  const classLevel = data.profile?.classLevel ?? 10
  for (const subject of data.subjects) {
    for (const chapter of unitsFor(classLevel, subject.name)) {
      const score = rank(chapter, '', query)
      if (!score) continue
      hits.push({
        kind: 'chapter',
        id: `${subject.id}::${chapter}`,
        title: chapter,
        detail: `${subject.name} · ${
          covered.has(`${subject.id}::${chapter}`) ? 'ticked off' : 'not ticked yet'
        }`,
        snippet: '',
        score,
      })
    }
  }

  // The open book is already on screen; the others are worth finding.
  for (const notebook of data.notebooks) {
    if (notebook.id === data.notebookId) continue
    const score = rank(notebook.name, '', query)
    if (!score) continue
    hits.push({
      kind: 'notebook',
      id: notebook.id,
      title: notebook.name,
      detail: 'Notebook',
      snippet: '',
      score,
    })
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title),
  )

  const seen: Record<string, number> = {}
  return hits.filter((hit) => {
    const count = seen[hit.kind] ?? 0
    if (count >= perKind) return false
    seen[hit.kind] = count + 1
    return true
  })
}
