/** What the dump test gathers after the erasure, for the gaps that are known. */
interface GapEvidence {
  /** What opens to a marker of the erased subject with a key that still exists, by where. */
  readonly opened: readonly string[];
  /** The marker the executor of the planted effect put into its secret output. */
  readonly effectOutput: string;
}

/** A place where personal data of an erased subject is still found, known and not yet closed. */
interface KnownGap {
  readonly name: string;
  /** What is found and where, in plain words. */
  readonly where: string;
  /** The work package that closes it: its entry is removed there. */
  readonly workPackage: 'WP-138';
  /** What the dump still shows of it: empty once it is closed, which fails the test until the entry is removed. */
  readonly found: (evidence: GapEvidence) => readonly string[];
}

/**
 * The gaps the erasure leaves in M2, pinned so that the inventory says the truth and no one has to
 * rediscover them (14.7.5). Each one has its own design. The dump test asserts that every entry IS
 * found: the work package that closes one removes its entry, and the test fails until it does.
 * The personal values in derived data (receipt fingerprints, decision records, job keys,
 * ciphertext lengths) are closed by WP-130 and checked by positive assertions of the dump test.
 */
const knownGaps: readonly KnownGap[] = [
  {
    name: 'the value key of a secret member of an effect output',
    where:
      'core__effect.output and the settled event in kw_events: the erasure destroys no value key of an effect record, so the output opens with the key that stays',
    workPackage: 'WP-138',
    found: (evidence) =>
      evidence.opened.filter((line) => line.startsWith(`${evidence.effectOutput} opens`)),
  },
];

export type { GapEvidence, KnownGap };
export { knownGaps };
