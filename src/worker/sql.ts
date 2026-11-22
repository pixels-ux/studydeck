/**
 * The subset of Cloudflare D1's query API this app uses.
 *
 * Keeping the app on this small surface lets the same worker run on D1 in
 * production and on a local SQLite file behind a plain Node server.
 */
export type SqlValue = string | number | boolean | null | undefined

export type SqlStatement = {
  bind(...values: SqlValue[]): SqlStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
}

export type SqlDatabase = {
  prepare(sql: string): SqlStatement
  batch(statements: SqlStatement[]): Promise<unknown[]>
}
