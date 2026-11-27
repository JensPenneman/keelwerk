import type { StreamRef } from '../events/stream-ref.ts';
import type { Gen } from '../protocol/gen.ts';

/**
 * What a module tells the erasure of a person about the names the person is held under in the
 * module's data (section 14.7.5), asked right before the person's keys are destroyed, in a
 * read-only unit of the tenant, with the authority of the module. There are three answers, each
 * optional. The kernel decides once which addresses are the person's: it collects what every
 * module's `addressesOf` answers, drops those that any module's `heldByOthers` names, and only
 * then asks every module's `heldBy` with what is left, so every module's addresses reach every
 * other module's rows, and no module's own filtering is relied on for another module's rows.
 */
export interface ErasureReach {
  readonly id: string;
  /**
   * The addresses the module holds for the person `subject`, opened under the person's own key
   * (a credential's identifier, a profile's email). It is asked once for each text the subject may
   * be stored as (`subjectSpellings`), because a row keeps the text its writer chose. A subject the
   * module knows nothing of answers none. The loads of the step see archived rows, so a profile
   * that is archived still answers its address; whether a living subject holds the address now is
   * not decided here but by `heldByOthers`.
   */
  addressesOf?(subject: string): Gen<readonly string[]>;
  /**
   * Which of `addresses` (everything the modules answered) a living subject other than the
   * person holds now, for what the module stores: an address of a live credential, of a profile
   * that is not archived. `subjects` are all the texts the person may be stored as
   * (`subjectSpellings`), so a row of the person is not another's. The kernel drops what any
   * module names, before it asks any module for rows.
   */
  heldByOthers?(addresses: readonly string[], subjects: readonly string[]): Gen<readonly string[]>;
  /**
   * The pending rows of the module's own entities that name one of `addresses` and that no one
   * but the address's holder is meant to read once the person is erased: each row's id is its own
   * data subject, and the kernel requests its erasure as the module's own (`eraseOwnSubject`).
   */
  heldBy?(addresses: readonly string[]): Gen<readonly StreamRef[]>;
}
