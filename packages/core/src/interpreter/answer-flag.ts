import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defaultFlagResolution } from '../flags/default-flag-resolution.ts';
import { flagSpecOf } from '../flags/flag-spec-of.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { FlagRequest } from '../protocol/flag-request.ts';
import { refuseRequest } from './refuse-request.ts';

/** What a flag request answers: the value, or its resolution for `ctx.flagDetails`. */
type FlagAnswer = boolean | string | number | FlagResolution<unknown>;

/**
 * Answers a flag request from the invocation's snapshot (20.3), or, without one, with the flag's
 * declared default and the reason `DEFAULT` (M1, decision 185), and records the read in the flags
 * the invocation read (S-23). The key is `<module id>.<flag>`.
 */
export async function answerFlag(
  request: FlagRequest,
  context: AnswerContext,
): Promise<FlagAnswer> {
  const spec = flagSpecOf(context.registry, request.key);
  if (spec === undefined) {
    throw refuseRequest('flag', `"${request.key}" is not a flag of this app`);
  }
  const resolution: FlagResolution<unknown> =
    context.flagSnapshot?.read(request.key) ?? defaultFlagResolution(spec);
  context.record.flag({
    key: request.key,
    variant: resolution.variant,
    reason: resolution.reason,
    ruleVersion: resolution.ruleVersion ?? null,
  });
  return request.details ? resolution : (resolution.value as FlagAnswer);
}
