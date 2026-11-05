import type { WireError } from '../errors/wire-error.ts';
import type { AnyRequest } from '../protocol/any-request.ts';
import type { AnswerContext } from './answer-context.ts';
import type { IssuedSecret } from './issued-secret.ts';

/** The answer type of each request kind (S-50). */
interface RequestAnswers {
  /** Rows, a count or a boolean, by `op`. */
  load: unknown;
  /** The inner request's answer, or undefined when the module is absent. */
  maybe: unknown;
  /** The dependency query's output. */
  ask: unknown;
  /** One answer per member, in order. */
  all: readonly unknown[];
  /** The flag's value (any kind of 20.2; json values are objects, hence `unknown` in the details), or its `FlagResolution` (20.3) for `ctx.flagDetails`. */
  flag:
    | boolean
    | string
    | number
    | {
        readonly value: unknown;
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
        readonly provider: string;
      };
  id: string;
  random: Uint8Array;
  /** `issue`, `reveal` and `verify`, by `op`. */
  secret: IssuedSecret | string | boolean;
  /** `argon2idHash` answers the encoded hash, `argon2idVerify` and `argon2idNeedsRehash` a boolean. */
  compute: string | boolean;
  /** An inline effect's outcome as a value. */
  perform:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: WireError };
}

/** One answerer per request kind; the interpreter picks by `kind` and refuses a kind it has none for (S-06). */
export type RequestAnswerer = {
  readonly [K in AnyRequest['kind']]: (
    request: Extract<AnyRequest, { readonly kind: K }>,
    context: AnswerContext,
  ) => Promise<RequestAnswers[K]>;
};
