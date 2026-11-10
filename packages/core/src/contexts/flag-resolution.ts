/**
 * The resolution of one flag, with its reason (20.3, S-171). M1 answers the declared default with
 * reason `DEFAULT` (decision 185); `T` defaults to the value of a boolean or string flag.
 */
export interface FlagResolution<T = boolean | string> {
  readonly value: T;
  readonly variant: string;
  readonly reason:
    | 'STATIC'
    | 'DEFAULT'
    | 'TARGETING_MATCH'
    | 'SPLIT'
    | 'DISABLED'
    | 'CACHED'
    | 'STALE'
    | 'ERROR';
  readonly errorCode?:
    | 'FLAG_NOT_FOUND'
    | 'TYPE_MISMATCH'
    | 'TARGETING_KEY_MISSING'
    | 'PARSE_ERROR'
    | 'GENERAL';
  readonly ruleId?: string;
  readonly ruleVersion?: number;
  /** `'default'` when nothing decided (20.2). */
  readonly provider: string;
}
