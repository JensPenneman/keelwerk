/** What a test sets and reads on the relay module. */
export const relayControl: {
  /** The attempts the flaky reaction has been given, by event id. */
  readonly attempts: Map<string, number>;
  /** `<reaction>:<signal id>` for every decision, in the order they were made (rolled-back attempts included). */
  readonly decided: string[];
  /** Channels whose key function throws: a poisoned event of the ordered reaction. */
  readonly poison: Set<string>;
  /** When true the ordered reaction no longer refuses the text `bad`: the fix a dead letter waits for. */
  fixed: boolean;
  /** When set, the key function of the tally process answers this instance: a deploy that changed the function. */
  tallyKey: string | undefined;
  /** When set, `relay.crash` runs this instead of its bug: it may throw, and answers ok when it returns. */
  crashPlan: (() => void) | undefined;
} = {
  attempts: new Map(),
  decided: [],
  poison: new Set(),
  fixed: false,
  tallyKey: undefined,
  crashPlan: undefined,
};
