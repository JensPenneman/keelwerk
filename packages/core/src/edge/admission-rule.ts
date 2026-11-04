import type { RequestInfo } from '../invoker/request-info.ts';
import type { Principal } from '../principals/principal.ts';
import type { Gen } from '../protocol/gen.ts';
import type { Scope } from '../storage/scope.ts';
import type { AdmissionVerdict } from './admission-verdict.ts';

/** What an admission rule sees at `admit`. */
export interface AdmissionInput {
  readonly action: string;
  readonly scope: Scope;
  readonly principal: Principal;
  readonly request: RequestInfo;
  /** The wire form of the input, taken before `validate`, so a rule can key a bucket by an identifier (section 17.2.6). */
  readonly input: unknown;
}

/** A pure function or generator run at `admit`; it never wraps or skips a stage (section 5.6). */
export type AdmissionRule = (input: AdmissionInput) => AdmissionVerdict | Gen<AdmissionVerdict>;
