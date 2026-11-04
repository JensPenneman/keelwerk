import type { HttpHandler } from '@keelwerk/core';

/** One transport's handler under a prefix. */
export interface Mount {
  readonly transport: string;
  readonly prefix: string;
  readonly handler: HttpHandler;
}

/** The mounts of one app: longest prefix wins, overlapping prefixes are a `routeConflict`. */
export interface MountTable {
  add(spec: { readonly transport: string; readonly prefix: string }, handler: HttpHandler): void;
  match(path: string): Mount | undefined;
}
