/**
 * Minimal ambient declaration for bun's built-in `bun:sqlite` so `tsc` can
 * typecheck this package without pulling in `bun-types` (which conflicts with
 * `@types/node`). The runtime implementation is provided by bun itself.
 */
declare module 'bun:sqlite' {
  export type SQLQueryBindings = string | number | bigint | boolean | null | Uint8Array

  export class Statement<T = unknown> {
    all(...params: SQLQueryBindings[]): T[]
    get(...params: SQLQueryBindings[]): T | null
    run(...params: SQLQueryBindings[]): { lastInsertRowid: number | bigint; changes: number }
    values(...params: SQLQueryBindings[]): unknown[][]
    finalize(): void
  }

  export class Database {
    constructor(filename?: string, options?: { readonly?: boolean; create?: boolean; readwrite?: boolean })
    query<T = unknown>(sql: string): Statement<T>
    prepare<T = unknown>(sql: string): Statement<T>
    run(sql: string, ...params: SQLQueryBindings[]): { lastInsertRowid: number | bigint; changes: number }
    exec(sql: string): void
    transaction<F extends (...args: never[]) => unknown>(fn: F): F
    close(): void
  }
}
