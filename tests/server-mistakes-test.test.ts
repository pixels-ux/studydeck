import { expect, test } from 'bun:test'
import type { WorkspaceData } from '../src/shared/types'
import { openDatabase } from '../src/node/sqlite'
import { cardKey } from '../src/shared/revision'
import { createApp } from '../src/server/app'
import { unitsFor } from '../src/shared/curriculum'

const call = (
  app: ReturnType<typeof createApp>,
  path: string,
  method = 'GET',
  body?: unknown,
  origin = 'http://localhost',
) =>
  app.request(`http://localhost${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const json = async <T,>(response: Response): Promise<T> =>
  response.json() as Promise<T>

const data = async (app: ReturnType<typeof createApp>) =>
  (await (await call(app, '/api/data')).json()) as WorkspaceData

type RevisionSheetRow = {
  subjectId: string
  subjectName: string
  chaptersTotal: number
  chaptersDone: number
  chaptersLeft: number
  examDate: string
  daysToExam: string | number
  weeksUntil: number
  overdueTasks: number
  mistakes: number
  status: 'clear' | 'watch' | 'behind'
  revisionHoursPerWeek: number
}

test('answering a flashcard Again adds it to mistakes per subject in workspace data', async () => {
  const db = openDatabase(':memory:')
  const app = createApp(db, {})

  // Create a note with flashcards under a subject
  const note = await call(app, '/api/notes', 'POST', {
    subjectId: 'maths',
    title: 'Flashcards · Algebra',
    body: ['Q: What is x?', 'A: It is unknown'].join('\n'),
  })
  expect(note.status).toBe(201)
  const noteId = (await note.json()).note.id

  // Get the card key for the question
  const q = 'What is x?'
  const key = cardKey(q)

  // Answer the card "Again"
  const answer = await call(app, '/api/review', 'POST', {
    noteId,
    cardKey: key,
    result: 'again',
  })
  expect(answer.status).toBe(200)

  // Check the workspace data reports mistakes for the subject
  const workspace = await data(app)
  expect(workspace.mistakes).toBeDefined()
  const mathsMistake = workspace.mistakes.find(
    (m) => m.subjectId === 'maths',
  )
  expect(mathsMistake).toBeDefined()
  expect(mathsMistake!.cards).toBe(1)

  // Check the /api/review/mistakes endpoint too
  const mistakesResp = await call(app, '/api/review/mistakes')
  const mistakesRespBody = await mistakesResp.json()
  expect(mistakesResp.status).toBe(200)
  const mistakes = mistakesRespBody as {
    total: number
    cards: { question: string; lapses: number }[]
  }
  expect(mistakes.total).toBe(1)
  expect(mistakes.cards).toHaveLength(1)
  expect(mistakes.cards[0].question).toContain('What is x')
  expect(mistakes.cards[0].lapses).toBe(1)
})

test('revision sheet reflects chapters, overdue, exam date, mistakes and status per subject', async () => {
  const db = openDatabase(':memory:')
  const app = createApp(db, {})

  // Two subjects: one behind, one watch, both with a real syllabus and one overdue task.
  const maths = await call(app, '/api/subjects', 'POST', {
    name: 'Mathematics',
    color: '#1f6feb',
    teacher: 'Mr. Rao',
    examDate: '2027-03-15',
  })
  const mathsBody = await maths.json()
  expect(mathsBody.subject.name).toBe('Mathematics')
  const mathsId = mathsBody.subject.id

  const tick1 = await call(app, '/api/syllabus', 'POST', {
    subjectId: mathsId,
    chapter: 'Real Numbers',
    done: true,
  })
  expect(tick1.status).toBe(200)
  const tick1Body = await tick1.json()
  expect(tick1Body.tickedAt).toBeGreaterThan(0)
  const tick2 = await call(app, '/api/syllabus', 'POST', {
    subjectId: mathsId,
    chapter: 'Polynomials',
    done: true,
  })
  expect(tick2.status).toBe(200)
  const tick2Body = await tick2.json()
  expect(tick2Body.tickedAt).toBeGreaterThan(0)

  const mathsUnits = unitsFor(10, 'Mathematics')
  const expectedMathsDone = mathsUnits.filter((ch) =>
    ch === 'Real Numbers' || ch === 'Polynomials',
  ).length

  await call(app, '/api/tasks', 'POST', {
    subjectId: mathsId,
    title: 'Remedial worksheets',
    dueDate: '2026-01-01',
    priority: 'normal',
    details: '',
    done: false,
  })
  await call(app, '/api/tasks', 'POST', {
    subjectId: mathsId,
    title: 'Textbook exercises',
    dueDate: '2026-01-01',
    priority: 'normal',
    details: '',
    done: false,
  })

  const physics = await call(app, '/api/subjects', 'POST', {
    name: 'Physics',
    color: '#3f6b52',
    teacher: 'Ms. Iyer',
    examDate: '',
  })
  const physicsBody = await physics.json()
  expect(physicsBody.subject.name).toBe('Physics')
  const physicsId = physicsBody.subject.id

  // Takeaways on a card under a note, to create mistakes for the behind scorer.
  const note = await call(app, '/api/notes', 'POST', {
    subjectId: physicsId,
    title: 'Flashcards · Mechanics',
    body: ['Q: What is weight?', 'A: Mass times g.'].join('\n'),
  })
  expect(note.status).toBe(201)
  const noteBody = await note.json()
  const noteId = noteBody.note.id

  const key = cardKey('What is weight?')

  // Answer Again on the physics card once.
  const again1 = await call(app, '/api/review', 'POST', {
    noteId,
    cardKey: key,
    result: 'again',
  })
  expect(again1.status).toBe(200)

  // Also answer Again on the same card so lapses > 0 AND last_result 'again'.
  const again2 = await call(app, '/api/review', 'POST', {
    noteId,
    cardKey: key,
    result: 'again',
  })
  expect(again2.status).toBe(200)

  // Chemistry: no NCERT chapters at class 10 and no work yet, so it reads as clear.
  const chemistry = await call(app, '/api/subjects', 'POST', {
    name: 'Chemistry',
    color: '#7a5a3f',
    teacher: 'Ms. Rao',
    examDate: '',
  })
  const chemistryBody = await chemistry.json()
  expect(chemistryBody.subject.name).toBe('Chemistry')
  const chemistryId = chemistryBody.subject.id

  const response = await call(app, '/api/revision-sheet')
  expect(response.status).toBe(200)

  const sheet = (await response.json()) as {
    rows: RevisionSheetRow[]
    today: string
  }
  expect(sheet.rows).toHaveLength(3)

  const mathsRow = sheet.rows.find((r) => r.subjectId === mathsId)!
  const physicsRow = sheet.rows.find((r) => r.subjectId === physicsId)!
  const chemistryRow = sheet.rows.find((r) => r.subjectId === chemistryId)!

  // Mathematics: chapters come from the class-10 NCERT Mathematics syllabus.
  expect(mathsRow.chaptersTotal).toBe(mathsUnits.length)
  expect(mathsRow.chaptersDone).toBe(expectedMathsDone)
  expect(mathsRow.chaptersLeft).toBe(mathsUnits.length - expectedMathsDone)
  expect(mathsRow.examDate).toBe('2027-03-15')
  expect(typeof mathsRow.daysToExam).toBe('number')
  expect(Number(mathsRow.daysToExam)).toBeGreaterThan(0)
  expect(mathsRow.weeksUntil).toBeGreaterThanOrEqual(0.5)
  expect(mathsRow.overdueTasks).toBe(2)
  expect(mathsRow.mistakes).toBe(0)
  expect(mathsRow.status).toBe('behind')
  expect(typeof mathsRow.revisionHoursPerWeek).toBe('number')
  expect(mathsRow.revisionHoursPerWeek).toBeGreaterThan(0)

  // Physics: no NCERT chapters match the name at class 10, one Again card.
  expect(physicsRow.chaptersTotal).toBe(0)
  expect(physicsRow.chaptersDone).toBe(0)
  expect(physicsRow.chaptersLeft).toBe(0)
  expect(physicsRow.examDate).toBe('—')
  expect(physicsRow.daysToExam).toBe('—')
  expect(physicsRow.weeksUntil).toBe(8)
  expect(physicsRow.overdueTasks).toBe(0)
  expect(physicsRow.mistakes).toBe(1)
  expect(physicsRow.status).toBe('watch')
  expect(physicsRow.revisionHoursPerWeek).toBe(0)

  // Chemistry: no NCERT chapters at class 10 and nothing done yet.
  expect(chemistryRow.chaptersTotal).toBe(0)
  expect(chemistryRow.chaptersDone).toBe(0)
  expect(chemistryRow.chaptersLeft).toBe(0)
  expect(chemistryRow.examDate).toBe('—')
  expect(chemistryRow.daysToExam).toBe('—')
  expect(chemistryRow.weeksUntil).toBe(8)
  expect(chemistryRow.overdueTasks).toBe(0)
  expect(chemistryRow.mistakes).toBe(0)
  expect(chemistryRow.status).toBe('clear')
  expect(chemistryRow.revisionHoursPerWeek).toBe(0)

  // Rows are ordered by status priority, then exam proximity.
  expect(sheet.rows[0].status).toBe('behind')
  expect(sheet.rows[0].subjectId).toBe(mathsId)
  expect(sheet.rows[1].status).toBe('watch')
  expect(sheet.rows[1].subjectId).toBe(physicsId)
  expect(sheet.rows[2].status).toBe('clear')
  expect(sheet.rows[2].subjectId).toBe(chemistryId)
})