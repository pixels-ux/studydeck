import { expect, test } from 'bun:test'
import type { WorkspaceData } from '../src/shared/types'
import { openDatabase } from '../src/node/sqlite'
import { cardKey } from '../src/shared/revision'
import { createApp } from '../src/server/app'

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

const data = async (app: ReturnType<typeof createApp>) =>
  (await (await call(app, '/api/data')).json()) as WorkspaceData

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
  expect(mistakesResp.status).toBe(200)
  const mistakes = (await mistakesResp.json()) as {
    total: number
    cards: { question: string; lapses: number }[]
  }
  expect(mistakes.total).toBe(1)
  expect(mistakes.cards).toHaveLength(1)
  expect(mistakes.cards[0].question).toContain('What is x')
  expect(mistakes.cards[0].lapses).toBe(1)
})