/**
 * Minimal ambient declaration for bun's built-in `bun:test`, mirroring the
 * `bun:sqlite` shim: lets `tsc` typecheck tests without `bun-types` (which
 * conflicts with `@types/node`). The runtime is provided by `bun test`.
 */
declare module 'bun:test' {
  interface Matchers {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toHaveLength(expected: number): void
    toBeDefined(): void
    toBeNull(): void
    toBeUndefined(): void
  }

  export function describe(label: string, fn: () => void): void
  export function test(label: string, fn: () => void | Promise<void>): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function expect(actual: unknown): Matchers
}
