import type { AppliedMigration, EntityDescriptor, NamespaceRef, TableSpec } from '@keelwerk/core';
import type { MemoryCollection } from './memory-collection.ts';

/** Everything the in-memory store keeps for one namespace. */
export interface MemoryNamespace {
  readonly ref: NamespaceRef;
  /** The committed collections; a commit replaces entries, a unit works on a snapshot of the map. */
  readonly collections: Map<string, MemoryCollection>;
  /** Entity descriptors by ref, learned from the calls that name them. */
  readonly entities: Map<string, EntityDescriptor>;
  /** The tables the schema operations created, by physical name. */
  readonly tables: Map<string, TableSpec>;
  /** Entity ref to physical table name, from `createTable` steps. */
  readonly tableOf: Map<string, string>;
  readonly migrations: AppliedMigration[];
  /** Identity sequences are not transactional: a rolled-back unit leaves a gap, as on PostgreSQL; `ledger` is the identity of `kw_ledger.seq`. */
  readonly sequences: { job: number; lane: number; ledger: number };
}

/** An empty namespace. */
export function memoryNamespace(ref: NamespaceRef): MemoryNamespace {
  return {
    ref,
    collections: new Map(),
    entities: new Map(),
    tables: new Map(),
    tableOf: new Map(),
    migrations: [],
    sequences: { job: 0, lane: 0, ledger: 0 },
  };
}
