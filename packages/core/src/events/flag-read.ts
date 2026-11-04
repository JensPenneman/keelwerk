/** One flag the invocation read, with the variant it got and why (section 20.5). */
export interface FlagRead {
  readonly key: string;
  readonly variant: string;
  readonly reason: string;
  readonly ruleVersion: number | null;
}
