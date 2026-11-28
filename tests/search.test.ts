import { expect, test } from 'bun:test'
import { unitsFor } from '../src/shared/curriculum.ts'
import type { WorkspaceData } from '../src/shared/types'
import { searchEverything, snippetOf } from '../src/client/search.ts'

const chapter = unitsFor(10, 'Science')[0]!

function workspace(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    notebooks: [
      { id: 'b1', name: 'My notebook', createdAt: 0 },
      { id: 'b2', name: 'Physics exam', createdAt: 1 },
    ],
    notebookId: 'b1',
    subjects: [
      {
        id: 'sci',
        name: 'Science',
        color: '#3f6b52',
        teacher: '',
        examDate: '',
        createdAt: 0,
      },
    ],
    entries: [],
    days: [],
    tasks: [
      {
        id: 't1',
        subjectId: 'sci',
        title: 'Finish the lab report',
        dueDate: '2026-12-01',
        priority: 'normal',
        done: false,
        details: 'Pages 40 to 43',
        createdAt: 0,
      },
    ],
    notes: [
      {
        id: 'n1',
        subjectId: 'sci',
        title: 'Light',
        body: 'Refraction bends light at the boundary between media.',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'n2',
        subjectId: null,
        title: 'Chemistry revision',
        body: 'A passing mention of light, nothing more.',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    actions: [],
    syllabus: [{ subjectId: 'sci', chapter }],
    sources: [
      {
        id: 'm1',
        subjectId: 'sci',
        title: 'Chapter 10',
        origin: 'Pasted',
        body: 'Concave mirrors reflect light inward.',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    library: [],
    review: { due: 0, fresh: 0, total: 0, nextDue: '' },
    reviewStats: {
      streak: 0,
      bestStreak: 0,
      missedDays: 0,
      answeredToday: 0,
      recalled: 0,
      answers: 0,
      total: 0,
    },
    profile: {
      classLevel: 10,
      schoolDays: [0, 1, 2, 3, 4],
      schoolStart: 480,
      schoolEnd: 870,
      periodLength: 45,
      studyHours: 3,
      setupAt: 0,
    },
    ai: { enabled: false, remaining: 0, limit: 40, provider: null, model: null },
    ...overrides,
  }
}

test('a title match comes first, and every part of the notebook is searched', () => {
  const hits = searchEverything(workspace(), 'light')
  expect(hits[0]?.kind).toBe('note')
  expect(hits[0]?.title).toBe('Light')
  const kinds = new Set(hits.map((hit) => hit.kind))
  expect(kinds.has('material')).toBe(true)
  expect(kinds.has('chapter')).toBe(true)
  // The second note only mentions the word in its body.
  expect(hits.some((hit) => hit.title === 'Chemistry revision')).toBe(true)
})

test('chapters say whether they are ticked, and material names its subject', () => {
  const hits = searchEverything(workspace(), chapter.split(' ')[0]!.toLowerCase())
  const chapterHit = hits.find((hit) => hit.kind === 'chapter')
  expect(chapterHit?.id).toBe(`sci::${chapter}`)
  expect(chapterHit?.detail).toBe('Science · ticked off')
  const material = searchEverything(workspace(), 'mirrors')[0]
  expect(material?.detail).toBe('Science · material')
})

test('work is found by its details and shows its due date', () => {
  const hit = searchEverything(workspace(), 'pages')[0]
  expect(hit?.kind).toBe('task')
  expect(hit?.detail).toContain('due 2026-12-01')
  expect(hit?.snippet).toContain('Pages 40 to 43')
})

test('another notebook is found by name, but the open one is left out', () => {
  expect(searchEverything(workspace(), 'physics').map((hit) => hit.id)).toEqual(['b2'])
  expect(searchEverything(workspace(), 'my notebook')).toEqual([])
})

test('one letter is not enough, and each kind is capped', () => {
  expect(searchEverything(workspace(), 'l')).toEqual([])
  const notes = Array.from({ length: 6 }, (_, index) => ({
    id: `n${index}`,
    subjectId: null,
    title: `Light ${index}`,
    body: 'Body',
    createdAt: 0,
    updatedAt: 0,
  }))
  const hits = searchEverything(workspace({ notes }), 'light')
  expect(hits.filter((hit) => hit.kind === 'note')).toHaveLength(4)
})

test('a snippet keeps the words around the match', () => {
  const snippet = snippetOf(
    `${'filler '.repeat(30)}refraction happens${' tail'.repeat(30)}`,
    'refraction',
  )
  expect(snippet.startsWith('…')).toBe(true)
  expect(snippet.endsWith('…')).toBe(true)
  expect(snippet).toContain('refraction happens')
})
