/** What the dump test gathers after the erasure, for the gaps that are known. */
interface GapEvidence {
  /** The dump after the erasure, as text. */
  readonly after: string;
  /** The plain fingerprint (SHA-256 of the canonical command) of each planted command, by name. */
  readonly fingerprints: ReadonlyMap<string, string>;
  /** The tables (without schema) that hold the fingerprint of each command, for the commands whose fingerprint the dump after the erasure still holds. */
  readonly fingerprintsFound: ReadonlyMap<string, readonly string[]>;
  /** The job key a module built from a personal value, as it was written. */
  readonly jobKey: string;
  /** SHA-256 of the part a reaction's key was built from, which the job key holds. */
  readonly reactionKeyHash: string;
  /** The lengths in bytes of the ciphertexts that name the erased subject's data key. */
  readonly sealedLengths: readonly number[];
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
  readonly workPackage: 'WP-130' | 'WP-138';
  /** What the dump still shows of it: empty once it is closed, which fails the test until the entry is removed. */
  readonly found: (evidence: GapEvidence) => readonly string[];
}

/** The planted commands whose input carries a member declared personal, run by an operator. */
const personalMemberCommands = [
  'probe.subscribe',
  'probe.defer',
  'probe.armPersonal',
  'probe.remind',
] as const;

/** The planted commands run by an operator whose plain input member lands in a personal value of an entity. */
const plainMemberCommands = [
  'probe.open',
  'probe.answer.bea',
  'probe.answer.ada',
  'probe.jot',
  'probe.claim',
  'probe.send',
  'probe.notify.output',
  'probe.notify.refusal',
] as const;

/** `fingerprint:<command>@<table>` for each of the commands whose fingerprint the table still holds. */
const fingerprintsOf = (
  evidence: GapEvidence,
  table: string,
  names?: readonly string[],
): readonly string[] =>
  [...evidence.fingerprintsFound]
    .filter(([name, tables]) => tables.includes(table) && (names?.includes(name) ?? true))
    .map(([name]) => `fingerprint:${name}@${table}`);

/**
 * The gaps the erasure leaves in M2, pinned so that the inventory says the truth and no one has to
 * rediscover them (14.7.5). Each one changes a stored format of M1 and has its own design: personal
 * values in derived data. The dump test asserts that every entry IS found: the work package that
 * closes one removes its entry, and the test fails until it does.
 */
const knownGaps: readonly KnownGap[] = [
  {
    name: 'the fingerprint of a command with a personal input member that another principal ran',
    where:
      'core__command_receipt.fingerprint: the unsalted SHA-256 of the canonical input, which anyone holding the dump can check a guessed value against',
    workPackage: 'WP-130',
    found: (evidence) =>
      personalMemberCommands.flatMap((name) =>
        fingerprintsOf(evidence, 'core__command_receipt', [name]),
      ),
  },
  {
    name: 'the fingerprint of a command whose plain input member an entity stores as a personal value',
    where:
      'core__command_receipt.fingerprint: the same digest, for a command that declares the member plain (the entity seals it, the command does not)',
    workPackage: 'WP-130',
    found: (evidence) =>
      plainMemberCommands.flatMap((name) =>
        fingerprintsOf(evidence, 'core__command_receipt', [name]),
      ),
  },
  {
    name: 'the input digest in the decision record of an event, whoever ran the command',
    where:
      'kw_events: the decision record of a chain-hashed event holds the same unsalted digest of the canonical input, also for a command the subject ran itself',
    workPackage: 'WP-130',
    found: (evidence) => fingerprintsOf(evidence, 'kw_events'),
  },
  {
    name: 'a job key a module built from a personal value',
    where: 'kw_jobs.key of a timer an operator set: the key is stored as the module wrote it',
    workPackage: 'WP-130',
    found: (evidence) => (evidence.after.includes(evidence.jobKey) ? ['kw_jobs.key'] : []),
  },
  {
    name: 'a reaction key built from a personal value',
    where: 'kw_jobs.key of a reaction job: the unsalted SHA-256 of the key the reaction declared',
    workPackage: 'WP-130',
    found: (evidence) => (evidence.after.includes(evidence.reactionKeyHash) ? ['kw_jobs.key'] : []),
  },
  {
    name: 'the length of a short sealed value',
    where:
      'kw_events: a sealed personal boolean is 20 bytes for true and 21 for false, which the shred does not change',
    workPackage: 'WP-130',
    found: (evidence) =>
      evidence.sealedLengths.includes(20) && !evidence.sealedLengths.includes(21)
        ? ['ciphertext of 20 bytes (true)']
        : [],
  },
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
export { knownGaps, personalMemberCommands, plainMemberCommands };
