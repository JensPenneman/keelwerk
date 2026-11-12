/** What a job runs: an action through the invoker, the executor of an external effect (decision 50a), or the deadline of an external effect an outside performer holds. */
export type JobRun =
  | { readonly action: string; readonly input: unknown; readonly commandId?: string }
  | { readonly executor: string; readonly effect: string }
  /** The deadline timer of an external effect: the effect id. */
  | { readonly effectDeadline: string };
