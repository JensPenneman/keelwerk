/** What a job runs: an action through the invoker, or the executor of an external effect (decision 50a). */
export type JobRun =
  | { readonly action: string; readonly input: unknown }
  | { readonly executor: string; readonly effect: string };
