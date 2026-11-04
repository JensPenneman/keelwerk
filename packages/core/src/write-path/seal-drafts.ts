import type { AnyDraft } from '../protocol/any-draft.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';

/** What sealing credential material reads. */
export interface SealDraftsInput {
  readonly registry: Registry;
  readonly unit: Unit;
  readonly drafts: readonly AnyDraft[];
}

/**
 * Seals the credential material of the drafts with fresh value keys (section 15.1.6, step 6). The
 * credential work package fills this in; until then the drafts pass unchanged.
 */
export async function sealDrafts(input: SealDraftsInput): Promise<readonly AnyDraft[]> {
  return input.drafts;
}
