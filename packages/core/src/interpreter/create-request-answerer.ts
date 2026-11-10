import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { answerAsk } from './answer-ask.ts';
import { answerCompute } from './answer-compute.ts';
import type { AnswerDeps, ScopeRunner } from './answer-deps.ts';
import { answerFlag } from './answer-flag.ts';
import { answerId } from './answer-id.ts';
import { answerLoad } from './answer-load.ts';
import { answerMaybe } from './answer-maybe.ts';
import { answerPerform } from './answer-perform.ts';
import { answerRandom } from './answer-random.ts';
import { answerSecret } from './answer-secret.ts';
import { batchAllMembers } from './batch-all-members.ts';
import type { ContextFactory } from './context-factory.ts';
import { createCallerViews } from './create-caller-views.ts';
import type { QueryStateEncoder } from './query-state-encoder.ts';
import type { RequestAuthorities } from './request-authorities.ts';

/** What the answerers of one invocation are built from. */
export interface AnswererOptions {
  /** The normalised rules, after the policy overrides, for the caller's view and the gate of `ask`. */
  readonly rules: readonly NormalizedRule[];
  /** The invoked action: its plan serves `ctx.target`. */
  readonly action?: ActionEntry;
  readonly inScope: ScopeRunner;
  readonly contexts: ContextFactory;
  /** Produces the `queryState` of a `query` load; default: the decimal position. */
  readonly queryState?: QueryStateEncoder;
  /** The authorities `contexts` records its requests in. */
  readonly authorities: RequestAuthorities;
  /** Later work packages replace the answerer of a kind (secrets, ids, random values, effects) without editing this file. */
  readonly replace?: Partial<RequestAnswerer>;
}

/**
 * The answerers, one per request kind (7.9.3): the seam later write-path and credential packages
 * plug into through `replace`. A kind the running release does not answer refuses with
 * `core.request_not_allowed` (S-06).
 */
export function createRequestAnswerer(options: AnswererOptions): RequestAnswerer {
  const deps: AnswerDeps = {
    ...(options.action === undefined ? {} : { action: options.action }),
    views: createCallerViews(options.rules, options.action),
    inScope: options.inScope,
    contexts: options.contexts,
    authorities: options.authorities,
    queryState: options.queryState ?? ((position) => position.toString()),
    get answerer() {
      return answerer;
    },
  };
  const answerer: RequestAnswerer = {
    load: (request, context) => answerLoad(request, context, deps),
    maybe: answerMaybe,
    ask: (request, context) => answerAsk(request, context, deps, options.rules),
    all: (request, context) => batchAllMembers(request, context, deps),
    flag: answerFlag,
    id: answerId,
    random: answerRandom,
    secret: answerSecret,
    compute: answerCompute,
    perform: answerPerform,
    ...options.replace,
  };
  return answerer;
}
