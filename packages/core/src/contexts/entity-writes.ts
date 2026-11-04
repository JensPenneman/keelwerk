import type { IdOf } from '../model/id-of.ts';
import type { ArchiveDraft } from '../protocol/archive-draft.ts';
import type { CreateDraft } from '../protocol/create-draft.ts';
import type { RestoreDraft } from '../protocol/restore-draft.ts';
import type { UpdateDraft } from '../protocol/update-draft.ts';

/**
 * Draft constructors of one entity, typed by `InsertOf` and `PatchOf` (section 14.8.1). A draft
 * built from a row carries that row's version; one built from an id carries none (S-21).
 */
export interface EntityWrites<R, I, P> {
  create(values: I): CreateDraft;
  update(target: IdOf<R> | R, patch: P): UpdateDraft;
  archive(target: IdOf<R> | R, options?: { readonly reason?: string }): ArchiveDraft;
  restore(target: IdOf<R> | R): RestoreDraft;
}
