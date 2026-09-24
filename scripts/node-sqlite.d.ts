// Minimal types for the built-in `node:sqlite` (Node 22.5+). The pinned
// @types/node 20 does not ship them; only what the scripts use is declared.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  }
}
