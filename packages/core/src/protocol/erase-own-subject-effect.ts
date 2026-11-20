import type { StreamRef } from '../events/stream-ref.ts';
import type { EffectDraft } from './effect-draft.ts';

/**
 * Asks the kernel to erase, as a data subject, the id of a row of the requesting module's own
 * entity (section 14.7.5), once nothing but that row holds the subject.
 */
export interface EraseOwnSubjectEffect extends EffectDraft<never> {
  readonly kind: 'eraseOwnSubject';
  readonly row: StreamRef;
}
