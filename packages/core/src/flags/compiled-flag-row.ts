import type { Condition } from '../conditions/condition.ts';
import type { FlagServe } from './flag-targeting.ts';

/** One rule as the cache interprets it. */
export interface CompiledFlagRule {
  readonly id: string;
  readonly tenants: ReadonlySet<string> | null;
  readonly principals: ReadonlySet<string> | null;
  readonly when: Condition | null;
  readonly serve: FlagServe;
}

/** One stored core.flag row, compiled once at load. */
export interface CompiledFlagRow {
  readonly id: string;
  readonly key: string;
  readonly backendId: string | null;
  /** The row's version: `FlagResolution.ruleVersion`. */
  readonly version: number;
  readonly enabled: boolean;
  readonly rules: readonly CompiledFlagRule[];
  readonly fallthrough: FlagServe;
}
