import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SqlDatabase, SqlStatement, SqlValue } from '../server/sql'

/** The value types `node:sqlite` accepts as bound parameters. */
type Param = null | number | bigint | string | Uint8Array

const toParam = (value: SqlValue): Param => {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

/**
 * One SQLite connection dressed in the D1 query surface the worker uses.
 * SQLite is synchronous, so the adapter caches prepared statements and
 * resolves immediately; that keeps route code unchanged.
 */
export class SqliteDatabase implements SqlDatabase {
  readonly #db: DatabaseSync
  readonly #statements = new Map<string, ReturnType<DatabaseSync['prepare']>>()

  constructor(file: string) {
    this.#db = new DatabaseSync(file)
    this.#db.exec('PRAGMA journal_mode = WAL')
    this.#db.exec('PRAGMA foreign_keys = ON')
    this.#db.exec('PRAGMA busy_timeout = 5000')
  }

  statement(sql: string): ReturnType<DatabaseSync['prepare']> {
    let prepared = this.#statements.get(sql)
    if (!prepared) {
      prepared = this.#db.prepare(sql)
      this.#statements.set(sql, prepared)
    }
    return prepared
  }

  prepare(sql: string): SqlStatement {
    return new SqliteStatement(this, sql, [])
  }

  async batch(statements: SqlStatement[]): Promise<unknown[]> {
    const results: unknown[] = []
    this.#db.exec('BEGIN')
    try {
      for (const statement of statements) results.push(await statement.run())
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    return results
  }

  close(): void {
    this.#statements.clear()
    this.#db.close()
  }
}

class SqliteStatement implements SqlStatement {
  readonly #db: SqliteDatabase
  readonly #sql: string
  readonly #params: SqlValue[]

  constructor(db: SqliteDatabase, sql: string, params: SqlValue[]) {
    this.#db = db
    this.#sql = sql
    this.#params = params
  }

  bind(...values: SqlValue[]): SqlStatement {
    return new SqliteStatement(this.#db, this.#sql, values)
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.#db
      .statement(this.#sql)
      .get(...this.#params.map(toParam))
    return row === undefined ? null : (row as T)
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.#db
      .statement(this.#sql)
      .all(...this.#params.map(toParam))
    return { results: rows as T[] }
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const result = this.#db
      .statement(this.#sql)
      .run(...this.#params.map(toParam))
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

/** Opens (and creates) the SQLite file behind a Node deployment. */
export function openDatabase(file: string): SqliteDatabase {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  return new SqliteDatabase(file)
}
