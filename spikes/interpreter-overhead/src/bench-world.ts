import type {
  EntityBehaviours,
  EntityDescriptor,
  NamespaceRef,
  Registry,
  Scope,
} from '@keelwerk/core';
import type { TestRuntime } from '@keelwerk/testing';
import type { BenchApp } from './bench-app.ts';

/** A running measurement target: the runtime of the bench app, its scope and the rows the commands load and write. */
export interface BenchWorld {
  readonly label: 'memory' | 'postgres';
  readonly runtime: TestRuntime<BenchApp, 'acme'>;
  readonly registry: Registry;
  readonly namespace: NamespaceRef;
  readonly scope: Scope;
  readonly behaviours: EntityBehaviours;
  readonly descriptor: EntityDescriptor;
  /** The ids of the seeded items; the commands load the first ones and write `writeId`. */
  readonly ids: readonly string[];
  /** The item the commands write. Its event stream grows with the run, equally for every form. */
  readonly writeIds: readonly string[];
  stop(): Promise<void>;
}
