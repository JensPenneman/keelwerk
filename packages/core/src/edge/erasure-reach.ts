import type { StreamRef } from '../events/stream-ref.ts';
import type { Gen } from '../protocol/gen.ts';

/**
 * What a module tells the erasure of a person about the names the person is held under in the
 * module's data (section 14.7.5), asked right before the person's keys are destroyed, in a
 * read-only unit of the tenant, with the authority of the module, whose loads see archived rows.
 * There are four answers, each optional. The kernel filters the addresses once: it collects what
 * every module's `addressesOf` answers, drops those that any module's `heldByOthers` names, and
 * only then asks every module's `heldBy` and `bucketsOf`, so after the filter every module's
 * addresses reach every other module's rows and buckets, and no module's own filtering is relied
 * on for another module's. The kernel checks that the fill is an object with an id, that each row
 * of `heldBy` is a live row of a tenant entity of the answering module that has a data subject,
 * and, when the request's job starts, that nothing but that row holds its id as a subject or
 * reference. It takes on trust that the addresses that are left are the person's, that the rows
 * really name them and are meant to go with the person, and that `bucketsOf` names the buckets as
 * the module's rule does: a name that no rule writes forgets nothing.
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
   * module names, before it asks any module for rows or buckets.
   */
  heldByOthers?(addresses: readonly string[], subjects: readonly string[]): Gen<readonly string[]>;
  /**
   * The pending rows of the module's own entities that name one of `addresses` and that no one
   * but the address's holder is meant to read once the person is erased: each row's id is its own
   * data subject, and the kernel requests its erasure as the module's own (`eraseOwnSubject`).
   */
  heldBy?(addresses: readonly string[]): Gen<readonly StreamRef[]>;
  /**
   * The names, as the module's admission rule writes them, of the rate buckets that name the
   * person: by the subject (asked once for each text the subject may be stored as) and by each of
   * the `addresses`. A pure function. The kernel stores such a bucket under a keyed digest of the
   * module and the name, and forgets it twice: in the step `reach`, with the addresses, and in the
   * last purge of the erasure, after the shred, with none. A bucket that a failed attempt makes
   * with the address after the step (between it and the shred, or after the shred) stays.
   */
  bucketsOf?(person: {
    readonly subject: string;
    readonly addresses: readonly string[];
  }): readonly string[];
}
