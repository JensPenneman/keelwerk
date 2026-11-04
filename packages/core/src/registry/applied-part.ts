import type { Dependency } from '../model/any-module.ts';
import type { BehaviourView, EntityPatchView, RuntimeModule } from './runtime-module.ts';

/**
 * A contribution or a conditional part after the selection is known: where it goes, whether it
 * counts, and the track its columns belong to (section 14.6.1).
 */
export interface AppliedPart extends BehaviourView {
  /** 'auth->accounts', 'auth->accounts[teams]', 'auth[accounts]': also the migration track id. */
  readonly trackId: string;
  readonly kind: 'contribution' | 'conditional';
  readonly key: string;
  /** The module that wrote the part: the contributor, or the owner of a conditional part. */
  readonly declaredBy: RuntimeModule;
  /** The id of the module whose namespace the part adds to. */
  readonly target: string;
  readonly when: readonly Dependency[];
  readonly whenNames: readonly string[];
  /** The target is selected and every `when` module and contract is present. */
  readonly active: boolean;
  readonly droppedBecause?: 'targetAbsent' | 'whenUnsatisfied';
  readonly entities: { readonly [entity: string]: EntityPatchView };
}
