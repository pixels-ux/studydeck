import { afterEach, expect, test } from 'bun:test'
import type {
  LibraryMessage,
  Note,
  Source,
  Subject,
  WorkspaceData,
} from '../src/shared/types'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'
import type { Env } from '../src/server/env'
import { chunkSource, retrieve, search, terms } from '../src/server/library'

const env: Env = {
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'sk-test-123456',
  AI_MODEL: 'gpt-4o-mini',
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Every answer from these tests is this fixed string, so citations can be read. */
function stubAi(answer = 'Chlorophyll absorbs light, which drives photosynthesis [1].') {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(
      JSON.stringify({ choices: [{ message: { content: answer } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return () => calls
}

function harness(options: Env = env) {
  const app = createApp(openDatabase(':memory:'), options)
  const call = (
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
  const data = async () =>
    (await (await call('/api/data')).json()) as WorkspaceData
  return { app, call, data }
}

/** Three paragraphs long enough that they stay separate chunks. */
const PHOTOSYNTHESIS = [
  'Photosynthesis happens in the chloroplasts of leaf cells. Chlorophyll inside the chloroplast absorbs mostly red and blue light, which is why leaves look green. The light energy splits water, releasing oxygen, and the hydrogen is used to build glucose from carbon dioxide. Glucose is then stored as starch or used for growth, and the oxygen leaves the leaf through the stomata. '.repeat(2),
  'Stomata are tiny openings on the underside of a leaf. They let carbon dioxide in and oxygen out, and they close when the plant is short of water. Guard cells swell to open the pore and shrink to close it. Most transpiration happens through these pores, which is why a plant in hot sun may wilt even when the soil is wet. '.repeat(2),
  'Respiration is the opposite of photosynthesis in one way: it releases the energy stored in glucose. It happens in every living cell, all day and all night, while photosynthesis only happens where there is light. Aerobic respiration uses oxygen and gives off carbon dioxide and water; anaerobic respiration in muscles gives lactic acid. '.repeat(2),
].join('\n\n')

test('material is cut into readable paragraphs and the matching one is retrieved', () => {
  const chunks = chunkSource({
    id: 'a',
    title: 'Life processes',
    body: PHOTOSYNTHESIS,
  })
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.every((chunk) => chunk.text.length <= 1_400)).toBe(true)
  expect(chunks.map((chunk) => chunk.text).join(' ')).toContain('Stomata')

  // A single long paragraph is split rather than sent whole.
  const long = chunkSource({
    id: 'b',
    title: 'Long chapter',
    body: 'word '.repeat(1_200).trim(),
  })
  expect(long.length).toBeGreaterThan(1)

  expect(terms('Explain what photosynthesis does in the plant')).toEqual([
    'photosynthesis',
    'plant',
  ])

  const other = chunkSource({
    id: 'c',
    title: 'History',
    body: 'The Mughal empire expanded under Akbar and Shah Jahan.',
  })
  const cited = retrieve([...chunks, ...other], 'How does photosynthesis use chlorophyll?')
  expect(cited[0]).toMatchObject({
    index: 1,
    sourceId: 'a',
    sourceTitle: 'Life processes',
  })
  expect(cited[0]!.text).toContain('Chlorophyll')
  expect(cited.some((source) => source.sourceId === 'c')).toBe(false)

  // A question with nothing in common still gets material, so the model can
  // say the answer is not there instead of inventing one.
  const fallback = retrieve([...chunks, ...other], 'zzzz')
  expect(fallback.length).toBeGreaterThan(0)
  expect(fallback[0]!.index).toBe(1)

  const hits = search(chunks, 'stomata')
  expect(hits).toHaveLength(1)
  expect(hits[0]!.sourceTitle).toBe('Life processes')
  expect(hits[0]!.snippet.toLowerCase()).toContain('stomata')
})

test('the library stores material, cites it, searches it and makes notes', async () => {
  stubAi()
  const { call, data } = harness()

  const created = await call('/api/sources', 'POST', {
    title: '  Life processes ',
    origin: 'Pasted',
    body: PHOTOSYNTHESIS,
  })
  expect(created.status).toBe(201)
  const { source } = (await created.json()) as { source: Source }
  expect(source.title).toBe('Life processes')
  expect(source.subjectId).toBeNull()

  const workspace = await data()
  expect(workspace.sources).toHaveLength(1)
  expect(workspace.library).toHaveLength(0)

  const found = await call('/api/library/search?q=chlorophyll')
  expect(found.status).toBe(200)
  const hits = (await found.json()) as {
    results: { sourceId: string; snippet: string }[]
  }
  expect(hits.results[0]?.sourceId).toBe(source.id)
  expect(hits.results[0]?.snippet.toLowerCase()).toContain('chlorophyll')

  const ask = await call('/api/library/ask', 'POST', {
    question: 'How does photosynthesis work?',
  })
  expect(ask.status).toBe(200)
  const answer = (await ask.json()) as {
    student: LibraryMessage
    reply: LibraryMessage
    remaining: number
  }
  expect(answer.remaining).toBe(39)
  expect(answer.reply.body).toContain('Chlorophyll')
  expect(answer.reply.citations[0]).toMatchObject({
    index: 1,
    sourceId: source.id,
    sourceTitle: 'Life processes',
  })

  // The exchange is kept, so a reload shows the notebook as it was left.
  const afterAsk = await data()
  expect(afterAsk.library).toHaveLength(2)
  expect(afterAsk.library[0]?.role).toBe('student')

  const summary = await call('/api/library/transform', 'POST', {
    sourceId: source.id,
    kind: 'summary',
  })
  expect(summary.status).toBe(200)
  const saved = (await summary.json()) as { note: Note }
  expect(saved.note.title).toBe('Summary · Life processes')
  expect(saved.note.subjectId).toBeNull()

  const questions = await call('/api/library/transform', 'POST', {
    sourceId: source.id,
    kind: 'questions',
  })
  const practice = (await questions.json()) as { note: Note }
  expect(practice.note.title).toBe('Practice questions · Life processes')
  expect((await data()).notes).toHaveLength(2)

  const cleared = await call('/api/library/messages', 'DELETE')
  expect(cleared.status).toBe(200)
  const afterClear = await data()
  expect(afterClear.library).toHaveLength(0)
  expect(afterClear.sources).toHaveLength(1)

  for (const body of [{}, { body: '   ' }, { body: 'x'.repeat(20_001) }]) {
    expect((await call('/api/sources', 'POST', body)).status).toBe(400)
  }
  expect(
    (
      await call('/api/sources', 'POST', {
        body: 'Text',
        subjectId: 'not-a-subject',
      })
    ).status,
  ).toBe(404)
  expect(
    (await call(`/api/sources/${source.id}`, 'PATCH', { body: '' })).status,
  ).toBe(400)
  expect(
    (await call(`/api/sources/${source.id}`, 'PATCH', {
      title: 'Life processes, revised',
      body: PHOTOSYNTHESIS,
    })).status,
  ).toBe(200)
  expect(
    (await call('/api/sources/not-a-source', 'DELETE')).status,
  ).toBe(404)

  expect((await call(`/api/sources/${source.id}`, 'DELETE')).status).toBe(200)
  expect((await data()).sources).toHaveLength(0)
  expect(
    (await call('/api/library/ask', 'POST', { question: 'Anything?' })).status,
  ).toBe(400)
})

test('a library question and its cited answer travel in the backup', async () => {
  stubAi()
  const { call } = harness()

  const created = await call('/api/sources', 'POST', {
    title: 'Life processes',
    body: PHOTOSYNTHESIS,
  })
  expect(created.status).toBe(201)
  const { source } = (await created.json()) as { source: Source }

  const asked = await call('/api/library/ask', 'POST', {
    question: 'How does chlorophyll use light?',
  })
  expect(asked.status).toBe(200)

  const exported = (await (await call('/api/export')).json()) as {
    notebooks: { library: LibraryMessage[] }[]
  }
  const library = exported.notebooks[0]!.library
  expect(library.map((message) => message.role)).toEqual([
    'student',
    'assistant',
  ])
  expect(library[0]!.body).toBe('How does chlorophyll use light?')
  expect(library[1]!.body).toContain('Chlorophyll absorbs light')
  expect(library[1]!.citations[0]).toMatchObject({
    index: 1,
    sourceId: source.id,
    sourceTitle: 'Life processes',
  })
})

test('material follows its subject, travels in the backup and is reset', async () => {
  const { call, data } = harness()

  const subjectResponse = await call('/api/subjects', 'POST', {
    name: 'Biology',
    color: '#3f6b52',
  })
  const { subject } = (await subjectResponse.json()) as { subject: Subject }

  const created = await call('/api/sources', 'POST', {
    title: 'Chapter 6',
    subjectId: subject.id,
    body: PHOTOSYNTHESIS,
  })
  expect(created.status).toBe(201)

  const scoped = await call(`/api/library/search?q=stomata&subjectId=${subject.id}`)
  expect(((await scoped.json()) as { results: unknown[] }).results).toHaveLength(1)

  const exported = (await (await call('/api/export')).json()) as {
    notebooks: { sources: { title: string }[] }[]
  }
  expect(exported.notebooks[0]!.sources.map((item) => item.title)).toEqual([
    'Chapter 6',
  ])

  // Deleting the subject keeps the material, unsorted.
  expect((await call(`/api/subjects/${subject.id}`, 'DELETE')).status).toBe(200)
  const afterSubject = await data()
  expect(afterSubject.sources[0]?.subjectId).toBeNull()

  expect((await call('/api/workspace', 'DELETE')).status).toBe(200)
  const reset = await data()
  expect(reset.sources).toHaveLength(0)
  expect(reset.library).toHaveLength(0)
})

test('find matches on meaning when the words differ', async () => {
  const { call } = harness({})
  const create = async (title: string, body: string) => {
    const response = await call('/api/sources', 'POST', {
      title,
      body,
      origin: 'Pasted',
      subjectId: null,
    })
    expect(response.status).toBe(201)
    return (await response.json()) as { source: { id: string } }
  }

  const sugar = await create(
    'Photosynthesis',
    'Photosynthesis makes glucose, a kind of sugar, inside the chloroplast.',
  )
  const phloem = await create(
    'Transport',
    'Sugars travel through the phloem to every part of the plant.',
  )
  await create(
    'Respiration',
    'Mitochondria release energy from food during respiration.',
  )

  const found = (await (
    await call('/api/library/search?q=glucose')
  ).json()) as { results: { sourceId: string; byMeaning: boolean }[] }
  expect(found.results[0]).toMatchObject({
    sourceId: sugar.source.id,
    byMeaning: false,
  })
  // Nothing here says "glucose", but the material links sugar to it.
  expect(
    found.results.find((hit) => hit.sourceId === phloem.source.id)?.byMeaning,
  ).toBe(true)

  // A word the material never uses finds nothing at all.
  const missing = (await (
    await call('/api/library/search?q=quasar')
  ).json()) as { results: unknown[] }
  expect(missing.results).toHaveLength(0)

  // Editing material rebuilds the index: the replaced word no longer finds it.
  const edited = await call(`/api/sources/${phloem.source.id}`, 'PATCH', {
    title: 'Transport',
    body: 'Water travels through the xylem to every part of the plant.',
    origin: 'Pasted',
    subjectId: null,
  })
  expect(edited.status).toBe(200)
  const after = (await (
    await call('/api/library/search?q=phloem')
  ).json()) as { results: { sourceId: string }[] }
  expect(after.results.some((hit) => hit.sourceId === phloem.source.id)).toBe(
    false,
  )
})

test('a library question is grounded in material that matches by meaning', async () => {
  stubAi('Sugar is carried through the phloem [2].')
  const { call } = harness()
  const create = async (title: string, body: string) => {
    const response = await call('/api/sources', 'POST', {
      title,
      body,
      origin: 'Pasted',
      subjectId: null,
    })
    expect(response.status).toBe(201)
    return (await response.json()) as { source: Source }
  }

  const sugar = await create(
    'Photosynthesis',
    'Photosynthesis makes glucose, a kind of sugar, inside the chloroplast.',
  )
  const phloem = await create(
    'Transport',
    'Sugars travel through the phloem to every part of the plant.',
  )
  await create(
    'Respiration',
    'Mitochondria release energy from food during respiration.',
  )

  const ask = await call('/api/library/ask', 'POST', { question: 'glucose' })
  expect(ask.status).toBe(200)
  const answer = (await ask.json()) as { reply: LibraryMessage }
  const citations = answer.reply.citations
  expect(citations[0]?.sourceId).toBe(sugar.source.id)
  // Nothing in that passage says "glucose"; the material linked the two.
  const near = citations.find((item) => item.sourceId === phloem.source.id)
  expect(near).toBeDefined()
  // The number still means the passage the model was actually given.
  expect(near!.index).toBe(2)
  expect(citations.filter((item) => item.sourceId === phloem.source.id)).toHaveLength(1)
})

test('the library says so when no AI provider is configured', async () => {
  const { call } = harness({})
  const created = await call('/api/sources', 'POST', {
    title: 'Notes',
    body: PHOTOSYNTHESIS,
  })
  const { source } = (await created.json()) as { source: Source }

  const ask = await call('/api/library/ask', 'POST', { question: 'Explain' })
  expect(ask.status).toBe(503)

  const transform = await call('/api/library/transform', 'POST', {
    sourceId: source.id,
    kind: 'summary',
  })
  expect(transform.status).toBe(503)
})

test('a subject turns all of its material into one deck', async () => {
  stubAi('Q: What drives photosynthesis?\nA: Chlorophyll absorbs light.')
  const { call } = harness()
  const created = await call('/api/subjects', 'POST', {
    name: 'Biology',
    color: '#3f6b52',
  })
  const { subject } = (await created.json()) as { subject: Subject }
  for (const title of ['Chapter 5', 'Chapter 6']) {
    expect(
      (
        await call('/api/sources', 'POST', {
          title,
          subjectId: subject.id,
          body: PHOTOSYNTHESIS,
        })
      ).status,
    ).toBe(201)
  }

  const deck = await call('/api/library/transform', 'POST', {
    subjectId: subject.id,
    kind: 'flashcards',
  })
  expect(deck.status).toBe(200)
  const { note } = (await deck.json()) as { note: Note }
  expect(note.title).toBe('Flashcards · Biology')
  expect(note.subjectId).toBe(subject.id)

  // An empty subject asks for material instead of inventing cards.
  const other = await call('/api/subjects', 'POST', {
    name: 'History',
    color: '#123456',
  })
  const { subject: history } = (await other.json()) as { subject: Subject }
  expect(
    (
      await call('/api/library/transform', 'POST', {
        subjectId: history.id,
        kind: 'slides',
      })
    ).status,
  ).toBe(400)

  // One item and a subject at the same time is a question with two answers.
  expect(
    (
      await call('/api/library/transform', 'POST', {
        sourceId: 'not-both',
        subjectId: subject.id,
        kind: 'slides',
      })
    ).status,
  ).toBe(400)
})

test('material can become flashcards or a slide outline', async () => {
  stubAi('Q: What drives photosynthesis?\nA: Chlorophyll absorbs light.')
  const { call } = harness()
  const created = await call('/api/sources', 'POST', {
    title: 'Life processes',
    body: PHOTOSYNTHESIS,
  })
  const { source } = (await created.json()) as { source: Source }

  const cards = await call('/api/library/transform', 'POST', {
    sourceId: source.id,
    kind: 'flashcards',
  })
  expect(cards.status).toBe(200)
  const card = (await cards.json()) as { note: Note }
  expect(card.note.title).toBe('Flashcards · Life processes')
  expect(card.note.body).toContain('Q: What drives photosynthesis?')
  expect(card.note.subjectId).toBeNull()

  const slides = await call('/api/library/transform', 'POST', {
    sourceId: source.id,
    kind: 'slides',
  })
  expect(slides.status).toBe(200)
  const slide = (await slides.json()) as { note: Note }
  expect(slide.note.title).toBe('Slides · Life processes')
  expect(slide.note.body).toContain('Q: What drives photosynthesis?')

  expect(
    (
      await call('/api/library/transform', 'POST', {
        sourceId: source.id,
        kind: 'podcast',
      })
    ).status,
  ).toBe(400)
})
