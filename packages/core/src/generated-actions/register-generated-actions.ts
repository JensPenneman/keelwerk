import type { GeneratedActionKind } from '../registry/generated-action-kind.ts';
import { generatedArchive } from './generated-archive.ts';
import { generatedChanges } from './generated-changes.ts';
import { generatedCreate } from './generated-create.ts';
import { generatedGet } from './generated-get.ts';
import type { GeneratedHandlerFactory } from './generated-handler-factory.ts';
import { generatedHistory } from './generated-history.ts';
import { generatedQuery } from './generated-query.ts';
import { generatedQueryChanges } from './generated-query-changes.ts';
import type { GeneratedRead } from './generated-read-input.ts';
import { generatedRestore } from './generated-restore.ts';
import { generatedUpdate } from './generated-update.ts';

/** The implementations of the generated actions, by the `generated` marker of the registry's action entry. */
export interface GeneratedActions {
  /** The reads, run in a read-only unit by `runGeneratedRead`. */
  readonly reads: Readonly<Partial<Record<GeneratedActionKind, GeneratedRead>>>;
  /** The `decide` of the instance and create commands; `set` is `generatedSet`, which needs the unit. */
  readonly handlers: Readonly<Partial<Record<GeneratedActionKind, GeneratedHandlerFactory>>>;
}

/** The generated actions of section 6.7 this release serves (`watch` is the live module's, M2). */
export function registerGeneratedActions(): GeneratedActions {
  return {
    reads: {
      get: generatedGet,
      query: generatedQuery,
      changes: generatedChanges,
      queryChanges: generatedQueryChanges,
      history: generatedHistory,
    },
    handlers: {
      create: generatedCreate,
      update: generatedUpdate,
      archive: generatedArchive,
      restore: generatedRestore,
    },
  };
}
