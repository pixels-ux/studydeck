import { afterEach, beforeEach, expect, test } from 'bun:test'
import { SqliteDatabase, openDatabase } from '../src/node/sqlite'

let db: SqliteDatabase

beforeEach(async () => {
  db = openDatabase(':memory:')
  await db
    .prepare(
      'CREATE TABLE chapter (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, done INTEGER NOT NULL)',
    )
    .run()
})
afterEach(() => db.close())

test('schema, insert and reads go through the D1-shaped surface', async () => {
  const insert = await db
    .prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)')
    .bind(1, 'Physics', true)
    .run()
  expect(insert).toEqual({ success: true, meta: { changes: 1 } })

  const row = await db
    .prepare('SELECT subject, done FROM chapter WHERE id = ?')
    .bind(1)
    .first<{ subject: string; done: number }>()
  expect(row).toEqual({ subject: 'Physics', done: 1 })


  await db
    .prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)')
    .bind(2, 'Maths', false)
    .run()
  const all = await db
    .prepare('SELECT id FROM chapter ORDER BY id')
    .all<{ id: number }>()
  expect(all.results).toEqual([{ id: 1 }, { id: 2 }])

  // Missing bindings become NULL, and the NOT NULL column refuses it.
  await expect(
    db.prepare('INSERT INTO chapter (id, subject) VALUES (?, ?)').bind(3, undefined).run(),
  ).rejects.toThrow()
})

test('batch commits every statement together', async () => {
  const results = await db.batch([
    db.prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)').bind(1, 'Physics', 0),
    db.prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)').bind(2, 'Maths', 1),
  ])
  expect(results).toEqual([
    { success: true, meta: { changes: 1 } },
    { success: true, meta: { changes: 1 } },
  ])
  expect((await db.prepare('SELECT COUNT(*) AS n FROM chapter').first<{ n: number }>())?.n).toBe(2)
})

test('a failing batch rolls back the statements before it', async () => {
  await db.batch([
    db.prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)').bind(7, 'Chemistry', 0),
  ])

  await expect(
    db.batch([
      db.prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)').bind(8, 'Biology', 0),
      db.prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)').bind(7, 'Dup', 0),
    ]),
  ).rejects.toThrow()

  const rows = await db.prepare('SELECT id FROM chapter ORDER BY id').all<{ id: number }>()
  expect(rows.results).toEqual([{ id: 7 }])

  // The connection is still usable after the rollback.
  const after = await db
    .prepare('INSERT INTO chapter (id, subject, done) VALUES (?, ?, ?)')
    .bind(9, 'History', 0)
    .run()
  expect(after.meta.changes).toBe(1)
})
